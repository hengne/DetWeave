/* Browser-only transport and durable storage. Geometry code remains the Python core. */
async function startDetWeavePortable(bundle) {
  const nativeFetch = window.fetch.bind(window);
  const decode = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const encode = (value) => {
    let text = '';
    for (let i = 0; i < value.length; i += 32768) text += String.fromCharCode(...value.subarray(i, i + 32768));
    return btoa(text);
  };
  const notice = document.getElementById('portable-loading');
  const english = () => window.DetWeaveI18n?.language === 'en';
  const label = (zh, en) => english() ? en : zh;
  const runtimeBase = 'https://detweave.invalid/embedded-runtime/';
  const resources = new Map(Object.entries(bundle.runtime).map(([name, value]) => [runtimeBase + name, decode(value)]));
  window.fetch = (url, options) => resources.has(String(url))
    ? Promise.resolve(new Response(resources.get(String(url)), {headers: {'Content-Type': String(url).endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'}}))
    : nativeFetch(url, options);
  const python = await loadPyodide({indexURL: runtimeBase, lockFileContents: bundle.lock});
  python.FS.mkdirTree('/app');
  python.FS.mkdirTree('/storage/browser');
  python.FS.writeFile('/app/payload.zip', decode(bundle.python));
  python.runPython("import sys, zipfile\nzipfile.ZipFile('/app/payload.zip').extractall('/app')\nsys.path.insert(0, '/app')\nexec(open('/app/portable_bridge.py').read())");
  function call(operation, data = {}) {
    const fn = python.globals.get('dw_call');
    let result;
    try { result = JSON.parse(fn(operation, JSON.stringify(data))); } finally { fn.destroy(); }
    if (result.error) { const error = new Error(result.error); error.code = result.code; throw error; }
    return result.value;
  }
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('DetWeave-portable-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Browser project storage is unavailable. / 浏览器项目存储不可用。'));
  });
  function db(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction('library', mode);
      const request = action(tx.objectStore('library'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(new Error('Project storage failed; export a library backup now. / 项目保存失败，请立即导出项目库备份。'));
    });
  }
  if (!navigator.locks) throw new Error('This browser cannot safely lock the project library. Use a current browser. / 请使用支持项目库锁定的新版浏览器。');
  await new Promise((resolve, reject) => {
    navigator.locks.request('DetWeave-portable-library', {ifAvailable:true}, (lock) => {
      if (!lock) { reject(new Error('This project library is already open in another tab. Close it before reopening. / 项目库已在另一标签页打开，请先关闭该页。')); return; }
      resolve(); return new Promise(() => {});
    }).catch(reject);
  });
  const saved = await db('readonly', (store) => store.get('snapshot'));
  if (saved) call('restore', {archive: saved});
  const handles = new Map(await db('readonly', (store) => store.get('handles')) || []);
  const modifiedFiles = new Map(await db('readonly', (store) => store.get('diskFingerprints')) || []);
  const fingerprint = async (bytes) => encode(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const warn = (message) => {
    let box=document.getElementById('portable-storage-warning');
    if (!box) { box=document.createElement('div'); box.id='portable-storage-warning'; box.setAttribute('role','alert'); box.style.cssText='padding:12px;background:#5a3210;color:white'; document.body.prepend(box); }
    box.textContent=message;
  };
  function filesUnder(path, relative = '') {
    const files = [];
    for (const name of python.FS.readdir(path)) {
      if (name === '.' || name === '..') continue;
      const full = path + '/' + name, rel = relative + name;
      if (python.FS.isDir(python.FS.stat(full).mode)) files.push(...filesUnder(full, rel + '/'));
      else files.push([rel, python.FS.readFile(full)]);
    }
    return files;
  }
  async function mirror() {
    try {
      for (const [id, handle] of handles) {
        const path = '/storage/handles/' + id;
        if (!python.FS.analyzePath(path).exists) continue;
        for (const [relative, data] of filesUnder(path)) {
          const current = await fingerprint(data), key=id+'/'+relative, previous=modifiedFiles.get(key);
          if (previous === current) continue;
          if (await handle.queryPermission({mode:'readwrite'}) !== 'granted') {
            throw new Error('Saved in browser only; folder permission expired. Choose the folder again to synchronize. / 已保存到浏览器，但尚未同步到文件夹：授权已过期，请重新选择目录。');
          }
          const parts=relative.split('/'); let directory=handle;
          for (const part of parts.slice(0,-1)) directory=await directory.getDirectoryHandle(part,{create:true});
          let file, existing;
          try { file=await directory.getFileHandle(parts.at(-1)); existing=await fingerprint(new Uint8Array(await (await file.getFile()).arrayBuffer())); }
          catch(error) { if(error.name!=='NotFoundError') throw error; }
          if (existing===current) { modifiedFiles.set(key,current); continue; }
          if ((existing && existing!==previous) || (!existing && previous)) {
            throw new Error('Saved in browser only. The disk project changed outside this tab; its files were not overwritten. Export a backup to preserve both versions. / 已保存到浏览器；磁盘项目已被其他程序修改，未覆盖原文件，请导出备份保留两个版本。');
          }
          file ||= await directory.getFileHandle(parts.at(-1),{create:true});
          const writable=await file.createWritable(); await writable.write(data); await writable.close();
          modifiedFiles.set(key,current);
        }
      }
    } finally {
      await db('readwrite',store=>store.put([...modifiedFiles],'diskFingerprints'));
    }
  }
  let pendingSave=Promise.resolve();
  function mutation(work) {
    const queued=pendingSave.catch(()=>{}).then(async()=>{
      const before=call('snapshot'); let result;
      try {
        result=await work();
        await db('readwrite',store=>store.put(call('snapshot'),'snapshot'));
      } catch(error) { call('reset',{archive:before}); throw error; }
      try { await mirror(); document.getElementById('portable-storage-warning')?.remove(); }
      catch(error) { warn(error.message); }
      return result;
    });
    pendingSave=queued; return queued;
  }
  const transaction=(operation,data)=>mutation(()=>call(operation,data));
  const persist=()=>mutation(()=>null);
  function friendly(value) {
    if (Array.isArray(value)) return value.map(friendly);
    if (!value || typeof value !== 'object') return value;
    const result = {...value};
    for (const key of ['path', 'folder']) {
      if (typeof result[key] !== 'string') continue;
      result[key] = result[key].replace('/storage/browser', label('浏览器项目库（请定期导出备份）', 'Browser project library (export backups regularly)'));
      for (const [id, handle] of handles) result[key] = result[key].replace('/storage/handles/' + id, handle.name);
      result[key] = result[key].replace(/\/storage\/handles\/[0-9a-f]{32}/g,label('浏览器中恢复的文件夹副本（尚未关联磁盘）','Restored browser folder copy (not linked to disk)'));
    }
    if (result.id === 'default' && result.label) result.label = label('浏览器项目库', 'Browser project library');
    for (const [key, child] of Object.entries(result)) if (typeof child === 'object') result[key] = friendly(child);
    return result;
  }
  if (window.showDirectoryPicker) window.DetWeaveSelectProjectFolder = async () => {
    let handle;
    try { handle = await window.showDirectoryPicker({mode:'readwrite', id:'detweave-projects'}); }
    catch (error) { if (error.name === 'AbortError') return null; throw error; }
    let id;
    for (const [existingId, existing] of handles) if (await handle.isSameEntry(existing)) { id = existingId; break; }
    id ||= crypto.randomUUID().replaceAll('-', '');
    handles.set(id, handle);
    await db('readwrite', (store) => store.put([...handles], 'handles'));
    return await mutation(async()=>{
    const result = call('register', {handle_id:id, label:handle.name});
    // Reopen existing DetWeave project folders only; never import unrelated user files.
    let imported = 0;
    async function readTree(directory, path, depth = 0) {
      if (depth > 6) throw new Error('Project folder nesting exceeds limit.');
      python.FS.mkdirTree(path);
      for await (const entry of directory.values()) {
        if (entry.kind === 'directory') await readTree(entry, path + '/' + entry.name, depth + 1);
        else {
          const file = await entry.getFile(); imported += file.size;
          if (imported > 100_000_000) throw new Error('Project folders exceed 100 MB.');
          const bytes = new Uint8Array(await file.arrayBuffer());
          const target = path + '/' + entry.name;
          if (!python.FS.analyzePath(target).exists) python.FS.writeFile(target, bytes);
        }
      }
    }
    for await (const entry of handle.values()) if (entry.kind === 'directory' && / -- [0-9a-f]{32}$/.test(entry.name)) {
      let metadata;
      try { metadata = JSON.parse(await (await (await entry.getFileHandle('project.json')).getFile()).text()); } catch { continue; }
      if (metadata.schema_version !== 1 || metadata.id !== entry.name.split(' -- ').at(-1)) continue;
      await readTree(entry, '/storage/handles/' + id + '/' + entry.name);
    }
    return friendly(result);
    });
  };
  const jsonResponse = (value, status = 200) => new Response(JSON.stringify(friendly(value)), {status, headers:{'Content-Type':'application/json'}});
  const encoder = new TextEncoder();
  async function extract(data, options) {
    const operationId = crypto.randomUUID();
    const args = {...data, operation_id:operationId};
    let spec;
    try {
      spec=await mutation(()=>{
        try { return call('start',args); }
        catch(error) {
          try { call('fail',{operation_id:operationId,code:error.code || 'configuration'}); } catch {}
          return {error:error.message};
        }
      });
    } catch(error) { call('release',args); return jsonResponse({error:error.message},507); }
    if(spec.error) { call('release',args); return jsonResponse({error:spec.error},400); }
    const controller = new AbortController();
    const signal = controller.signal;
    let abortCode = 'cancelled', completed = false, timer, idleTimer, heartbeat;
    options.signal?.addEventListener('abort', () => controller.abort(), {once:true});
    if (options.signal?.aborted) controller.abort();
    const started = performance.now();
    const stream = new ReadableStream({
      start(output) {
        const emit = (event) => { if (!completed) output.enqueue(encoder.encode(JSON.stringify({...event, elapsed_s:(performance.now()-started)/1000}) + '\n')); };
        const idle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => {abortCode='idle_timeout'; controller.abort();}, (spec.idle_s || 90)*1000); };
        (async () => {
          try {
            signal.throwIfAborted();
            emit({type:'status',stage:'preparing',message:'Browser Python core ready / 浏览器 Python 核心已就绪'});
            if (spec.demo) {
              call('demo', args); signal.throwIfAborted();
              const result = await mutation(()=>{ signal.throwIfAborted(); return call('accept',args); }); call('release', args);
              emit({type:'result', result}); return;
            }
            timer = setTimeout(() => {abortCode='total_timeout'; controller.abort();}, spec.total_s*1000);
            idle();
            heartbeat = setInterval(() => emit({type:'heartbeat',stage:'waiting_provider'}), 1000);
            emit({type:'status',stage:'connecting',message:'Calling provider directly / 正在直接连接服务商'});
            let response;
            try { response = await nativeFetch(spec.url, {method:'POST', headers:spec.headers, body:JSON.stringify(spec.body), signal, redirect:'error', credentials:'omit', referrerPolicy:'no-referrer'}); }
            catch (error) {
              if (signal.aborted) throw error;
              const failed = new Error('Browser request failed (network or provider CORS policy). Use the native app if this provider does not permit browser access. / 浏览器请求失败（网络或服务商跨域限制），可使用原生安装版。');
              failed.code = 'network_error'; throw failed;
            }
            if (!response.ok) { const failed = new Error('Provider HTTP ' + response.status); failed.code='provider_http'; throw failed; }
            const sse = response.headers.get('Content-Type')?.includes('text/event-stream');
            const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal:true});
            let buffer = '', frame = [], bytes = 0, doneMarker = false;
            const flush = () => {
              if (!frame.length) return;
              const value = frame.join('\n'); frame = [];
              if (value === '[DONE]') { doneMarker=true; return; }
              for (const event of call('feed', {operation_id:operationId,event:JSON.parse(value)})) emit(event);
            };
            while (true) {
              const part = await reader.read(); signal.throwIfAborted();
              if (part.value) { bytes += part.value.length; idle(); }
              if (bytes > (sse ? 12_000_000 : 2_000_000)) throw new Error('Provider response exceeds size limit.');
              buffer += part.done ? decoder.decode() : decoder.decode(part.value,{stream:true});
              if (sse) {
                let end;
                while ((end = buffer.indexOf('\n')) !== -1) {
                  const line = buffer.slice(0,end).replace(/\r$/, ''); buffer=buffer.slice(end+1);
                  if (!line) flush();
                  else if (line.startsWith('data:')) frame.push(line.slice(5).replace(/^ /,''));
                }
                if (buffer.length > 2_000_000 || frame.join('\n').length > 2_000_000) throw new Error('Provider event exceeds size limit.');
              }
              if (part.done || doneMarker) { if (doneMarker) { await reader.cancel(); buffer=''; frame=[]; } break; }
            }
            if (sse && (buffer.trim() || frame.length)) throw new Error('Incomplete provider stream.');
            if (!sse) for (const event of call('buffered', {operation_id:operationId,response:JSON.parse(buffer)})) emit(event);
            emit({type:'status',stage:'validating',message:'Validating geometry / 正在校验几何'});
            call('finish', args); signal.throwIfAborted();
            const result = await mutation(()=>{ signal.throwIfAborted(); return call('accept',args); }); call('release', args);
            emit({type:'result',result});
          } catch (error) {
            const code = signal.aborted ? abortCode : (error.code || 'extraction_error');
            try { await transaction('fail',{operation_id:operationId,code}); }
            catch { error = new Error('Could not persist run outcome. Export a library backup. / 无法保存运行结果，请导出项目库备份。'); }
            emit({type:'error',code,message:signal.aborted ? code : error.message});
          } finally {
            clearTimeout(timer); clearTimeout(idleTimer); clearInterval(heartbeat);
            call('release',args);
            if (!completed) { completed=true; output.close(); }
          }
        })();
      },
      cancel() { completed=true; controller.abort(); },
    });
    return new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}});
  }
  window.fetch = async (url, options = {}) => {
    if (!String(url).startsWith('/api/')) return nativeFetch(url, options);
    const path = String(url), data = options.body ? JSON.parse(options.body) : {}, post = options.method === 'POST';
    if (!post) await pendingSave.catch(()=>{});
    try {
      if (path === '/api/extract/stream') return await extract(data, options);
      let result;
      if (path === '/api/schema') result=call('schema');
      else if (path === '/api/examples') result=call('examples');
      else if (path === '/api/health') result={version:'0.2.0',status:'ok',runtime:'embedded-python-wasm'};
      else if (path === '/api/validate') result=call('validate',data);
      else if (path === '/api/projects/locations') {
        result=call('locations'); result.system_picker=Boolean(window.showDirectoryPicker);
      } else if (path === '/api/projects') result=post?await transaction('create',data):call('projects');
      else if (/^\/api\/projects\/[0-9a-f]+\/runs\/[0-9a-f]+$/.test(path)) {
        const parts=path.split('/'); result=call('run',{id:parts[3],run_id:parts[5]});
      } else if (/^\/api\/projects\/[0-9a-f]+$/.test(path)) {
        result=post?await transaction('update',{id:path.split('/')[3],changes:data}):call('get',{id:path.split('/')[3]});
      } else if (path === '/api/export') {
        result=await transaction('export',data);
        return new Response(decode(result),{headers:{'Content-Type':'application/zip'}});
      } else return jsonResponse({error:'Unsupported browser operation.'},404);
      
      return jsonResponse(result);
    } catch (error) { return jsonResponse({error:error.message},400); }
  };
  const bar=document.createElement('div'); bar.className='portable-bar';
  const text=document.createElement('span'), backup=document.createElement('button'), restore=document.createElement('button'), licenses=document.createElement('button'), input=document.createElement('input');
  backup.className=restore.className=licenses.className='button compact'; input.type='file'; input.accept='.zip'; input.hidden=true;
  function translateBar() {
    text.textContent=label('单文件版 · 数据保存在此浏览器或已授权目录；API 需要联网。', 'Single HTML · Projects use this browser or an authorized folder; APIs need internet.');
    licenses.textContent=label('许可与署名','Licenses and attribution');
    backup.textContent=label('备份全部项目（ZIP）','Back up all projects (ZIP)'); restore.textContent=label('导入项目库备份','Import library backup');
  }
  translateBar(); window.addEventListener('detweave:language',translateBar);
  new MutationObserver(translateBar).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  backup.onclick=async() => {
    await pendingSave.catch(()=>{});
    const link=document.createElement('a'), href=URL.createObjectURL(new Blob([decode(call('snapshot'))],{type:'application/zip'}));
    link.href=href; link.download='DetWeave-project-library.zip'; link.click(); setTimeout(()=>URL.revokeObjectURL(href),30000);
  };
  restore.onclick=()=>input.click();
  input.onchange=async()=>{
    try {
      const file=input.files[0]; if (!file) return;
      if (file.size>100_000_000) throw new Error('Archive exceeds 100 MB.');
      await transaction('restore',{archive:encode(new Uint8Array(await file.arrayBuffer()))}); location.reload();
    } catch(error) { alert(error.message); } finally { input.value=''; }
  };
  licenses.onclick=()=>{
    const link=document.createElement('a'), href=URL.createObjectURL(new Blob([bundle.notices],{type:'text/plain;charset=utf-8'}));
    link.href=href; link.download='DetWeave-licenses-and-attribution.txt'; link.click(); setTimeout(()=>URL.revokeObjectURL(href),30000);
  };
  bar.append(text,backup,restore,licenses,input); document.body.prepend(bar);
  notice.remove();
  window.DetWeavePortable={call,persist};
}
