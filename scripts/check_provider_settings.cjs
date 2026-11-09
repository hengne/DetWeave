/* Provider persistence uses synthetic keys and isolated user settings only. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.DETWEAVE_PLAYWRIGHT||'playwright');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'detweave-settings-'));let server,browser,origin;
 const launch=async()=>{
  server=spawn(process.env.DETWEAVE_PYTHON||'python3',['-m','detweave','serve','--dev-ui','--port','0'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,DETWEAVE_PROJECTS_DIR:path.join(dir,'projects'),DETWEAVE_SETTINGS_DIR:path.join(dir,'settings')},stdio:['ignore','pipe','pipe']});
  origin=await new Promise((resolve,reject)=>{let log='';const t=setTimeout(()=>reject(Error('Startup timed out')),15000);server.stdout.on('data',c=>{log+=c;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(t);resolve(m[0])}});server.once('exit',()=>{clearTimeout(t);reject(Error('Backend exited'))})});
 };
 const stop=()=>new Promise(resolve=>{server.once('exit',resolve);server.kill()});
 try{
  await launch();browser=await chromium.launch({headless:true,...(process.env.DETWEAVE_CHROME?{executablePath:process.env.DETWEAVE_CHROME}:{})});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#provider option[value="ark-coding"]')&&!document.querySelector('#provider').disabled&&window.detweaveProviderSettingsReady);await page.locator('.chat-settings summary').click();};
  const read=async()=>await (await page.request.get(origin+'/api/settings/providers',{headers:{'X-DetWeave':'1'}})).json();
  const wait=async fn=>{for(let n=0;n<100;n++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('Persistence condition timed out')};
  await open();await page.selectOption('#provider','ark-coding');await page.fill('#api-key','synthetic-ark-key');
  await wait(async()=>(await read()).profiles['ark-coding']?.api_key==='synthetic-ark-key');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#api-key').value==='synthetic-ark-key');assert.equal(await page.inputValue('#provider'),'ark-coding');
  await page.locator('.chat-settings summary').click();await page.selectOption('#provider','deepseek-official');
  assert.equal(await page.inputValue('#api-key'),'');await page.fill('#api-key','synthetic-deepseek-key');
  await wait(async()=>(await read()).profiles['deepseek-official']?.api_key==='synthetic-deepseek-key');
  await page.selectOption('#provider','ark-coding');await page.waitForFunction(()=>document.querySelector('#api-key').value==='synthetic-ark-key');
  await wait(async()=>(await read()).active==='ark-coding');
  await stop();await launch();await open();await page.waitForFunction(()=>document.querySelector('#api-key').value==='synthetic-ark-key');
  // Keys do not depend on browser origin or backend port.
  const browserStorage=await page.evaluate(()=>JSON.stringify({...localStorage}));assert(!browserStorage.includes('synthetic-ark-key'));
  const invalidSaves=[];page.on('response',r=>{if(r.url().endsWith('/api/settings/providers')&&r.status()===400)invalidSaves.push(r.status())});
  await page.fill('#total-timeout','12');await page.selectOption('#provider','deepseek-official');
  await wait(async()=>(await read()).active==='deepseek-official');
  assert.deepEqual(invalidSaves,[],'Switching during partial timeout input must not send invalid settings');
  await page.selectOption('#provider','ark-coding');
  await page.fill('#base-url','https://example.invalid/v1');assert.equal(await page.inputValue('#api-key'),'');
  await wait(async()=>(await read()).profiles['ark-coding']?.base_url==='https://example.invalid/v1');
  await page.click('#provider-forget');await wait(async()=>!(await read()).profiles['ark-coding']);
  assert.equal((await read()).profiles['deepseek-official'].api_key,'synthetic-deepseek-key');
  await page.reload();await page.waitForFunction(()=>window.detweaveProviderSettingsReady);assert.equal(await page.inputValue('#api-key'),'');
  assert.deepEqual(errors,[]);console.log('PASS provider persistence: autosave, reload, per-provider isolation, backend restart/new port, no key in localStorage.');
 }finally{await browser?.close();if(server?.exitCode===null)await stop();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
