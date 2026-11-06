/* Offline file:// integration and mock-provider tests; no model API calls. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.DETWEAVE_PLAYWRIGHT || 'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.DETWEAVE_CHROME,headless:true});
 try {
  const context=await browser.newContext({acceptDownloads:true});
  const page=await context.newPage(), errors=[], external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{
   if (route.request().url().startsWith('file:')) return route.continue();
   external.push(route.request().url()); return route.abort();
  });
  await context.setOffline(true);
  const file=path.resolve(process.argv[2] || 'dist/DetWeave-0.2.0.html');
  await page.goto('file://'+file);
  await page.waitForFunction(()=>Boolean(window.DetWeavePortable),{},{timeout:90000});
  assert.equal(await page.locator('#portable-loading').count(),0);
  const api=(route,body)=>page.evaluate(async({route,body})=>{
   const r=await fetch(route,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});return {status:r.status,data:await r.json()};
  },{route,body});
  const examples=(await api('/api/examples')).data;
  assert.equal(examples.length,2);
  for (const example of examples) {
   const report=(await api('/api/validate',{model:example.model})).data;
   assert.equal(report.checks.schema,'passed'); assert.ok(report.instances.length);
  }
  await page.selectOption('#project-menu','__new__');
  await page.fill('#project-create-name','Standalone 离线项目');
  assert.ok(await page.locator('#project-create-submit').isDisabled());
  // UI selectors deliberately follow the actual public workbench contract.
  const locations=(await api('/api/projects/locations')).data;
  assert.equal(locations.mode,'browser'); assert.equal(locations.register_path,false);
  const created=(await api('/api/projects',{title:'Standalone 离线项目',location_id:'default'})).data;
  assert.ok(created.folder.includes('项目库') || created.folder.includes('Browser'));
  const id=created.id;
  const result=await page.evaluate(async({text,id})=>{
   const r=await fetch('/api/extract/stream',{method:'POST',body:JSON.stringify({text,project_id:id,provider:{kind:'demo'}})});
   return (await r.text()).trim().split('\n').map(JSON.parse);
  },{text:examples[0].text,id});
  assert.equal(result.at(-1).type,'result');
  const model=result.at(-1).result.model;
  const bytes=await page.evaluate(async({model,id})=>{
   const r=await fetch('/api/export',{method:'POST',body:JSON.stringify({model,project_id:id})});
   if(!r.ok) throw new Error(await r.text()); return [...new Uint8Array(await r.arrayBuffer())];
  },{model,id});
  assert.equal(Buffer.from(bytes).subarray(0,2).toString(),'PK');
  fs.mkdirSync('local/standalone-qa',{recursive:true}); fs.writeFileSync('local/standalone-qa/geometry.zip',Buffer.from(bytes));
  await page.reload(); await page.waitForFunction(()=>Boolean(window.DetWeavePortable),{},{timeout:90000});
  const reopened=(await api('/api/projects/'+id)).data;
  assert.equal(reopened.prompts.length,1); assert.equal(reopened.runs[0].status,'succeeded'); assert.equal(reopened.exports.length,1);
  const backup=await page.evaluate(()=>window.DetWeavePortable.call('snapshot'));
  fs.writeFileSync('local/standalone-qa/library.zip',Buffer.from(backup,'base64'));
  assert.equal(external.length,0,'offline startup must not load CDN assets');
  // Direct browser protocol uses a controlled mock instead of a real API/key.
  await context.setOffline(false);
  await context.unroute('**/*');
  let requestBody;
  await context.route('https://mock.detweave.test/**',async route=>{
   requestBody=route.request().postDataJSON();
   await route.fulfill({status:200,contentType:'text/event-stream',body:
    'data: '+JSON.stringify({choices:[{index:0,delta:{reasoning_content:'Public test summary'}}]})+'\n\n'+
    'data: '+JSON.stringify({choices:[{index:0,delta:{content:JSON.stringify(model)}}]})+'\n\n'+
    'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'});
  });
  const remote=await page.evaluate(async({text,id})=>{
   const r=await fetch('/api/extract/stream',{method:'POST',body:JSON.stringify({text,project_id:id,provider:{kind:'openai',base_url:'https://mock.detweave.test/v1',model:'synthetic',api_key:'synthetic-only-key-not-a-secret'}})});
   return (await r.text()).trim().split('\n').map(JSON.parse);
  },{text:examples[0].text,id});
  assert.equal(remote.at(-1).type,'result'); assert.ok(remote.some(e=>e.type==='reasoning')); assert.equal(requestBody.stream,true);
  const snapshot=await page.evaluate(()=>window.DetWeavePortable.call('snapshot'));
  fs.writeFileSync('local/standalone-qa/remote-library.zip',Buffer.from(snapshot,'base64'));
  // A completion whose browser storage write fails must never become accepted geometry.
  const beforeFailure=(await api('/api/projects/'+id)).data.draft.model;
  await context.unroute('https://mock.detweave.test/**');
  await context.route('https://mock.detweave.test/**',async route=>{
   await page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){
     if(key==='snapshot'){ IDBObjectStore.prototype.put=original; throw new DOMException('Synthetic quota failure','QuotaExceededError'); }
     return original.call(this,value,key);
    };
   });
   const altered={...model,title:'Must not accept storage failure'};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(altered)}}]})});
  });
  const failed=await page.evaluate(async({text,id})=>{
   const r=await fetch('/api/extract/stream',{method:'POST',body:JSON.stringify({text,project_id:id,provider:{kind:'openai',base_url:'https://mock.detweave.test/v1',model:'synthetic',api_key:'synthetic-only-key-not-a-secret'}})});
   return (await r.text()).trim().split('\n').map(JSON.parse);
  },{text:examples[0].text,id});
  assert.equal(failed.at(-1).type,'error');
  const afterFailure=(await api('/api/projects/'+id)).data;
  assert.deepEqual(afterFailure.draft.model,beforeFailure);
  assert.equal(afterFailure.runs[0].status,'failed');
  // Invalid credentials configuration still records the submitted prompt as a failed run.
  const invalid=await api('/api/extract/stream',{text:examples[0].text+' invalid config',project_id:id,provider:{kind:'openai',model:'synthetic',base_url:'https://mock.detweave.test/v1'}});
  assert.equal(invalid.status,400);
  assert.equal((await api('/api/projects/'+id)).data.runs[0].status,'failed');
  await context.unroute('https://mock.detweave.test/**');
  await context.route('https://mock.detweave.test/**',async route=>{
   await new Promise(resolve=>setTimeout(resolve,200));
   try {await route.fulfill({status:200,contentType:'text/event-stream',body:''});} catch {}
  });
  await page.evaluate(async({text,id})=>{
   const r=await fetch('/api/extract/stream',{method:'POST',body:JSON.stringify({text,project_id:id,provider:{kind:'openai',base_url:'https://mock.detweave.test/v1',model:'synthetic',api_key:'synthetic-only-key-not-a-secret'}})});
   await r.body.cancel();
  },{text:examples[0].text,id});
  await page.waitForTimeout(350);
  assert.equal((await api('/api/projects/'+id)).data.runs[0].status,'cancelled');
  const second=await context.newPage();
  await second.goto('file://'+file);
  await second.waitForFunction(()=>document.getElementById('portable-loading')?.textContent.includes('already open'),{},{timeout:90000});
  await second.close();
  await page.screenshot({path:'local/standalone-qa/workbench.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Standalone PASS: offline file, embedded Python, validation, named project/history, reload persistence, geometry ZIP, mock SSE, storage rollback, cancelled stream, configuration history, second-tab lock, no CDN requests.');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
