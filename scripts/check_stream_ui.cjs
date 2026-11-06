/* Uses a local synthetic SSE provider, never an external API or real key. */
const {chromium}=require(process.env.DETWEAVE_PLAYWRIGHT || 'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fixture=JSON.parse(fs.readFileSync('examples/sampling.json','utf8'));
const wire=JSON.stringify(fixture);
const sse=(delta={},finish=null)=>'data: '+JSON.stringify({model:'synthetic-test-provider',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n';
(async()=>{
 let mode='success',active=new Set();
 const provider=http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
   assert(JSON.parse(body).stream);res.writeHead(200,{'Content-Type':'text/event-stream'});active.add(res);
   const timers=[];res.on('close',()=>{active.delete(res);timers.forEach(clearTimeout);});
   res.write(sse({reasoning_content:'合成服务商测试片段：核对单位与层数。<img src=x onerror=alert(1)>'}));
   if(mode==='cancel'){
    const pulse=()=>{if(!res.destroyed){res.write(': ping\n\n');timers.push(setTimeout(pulse,100));}};pulse();return;
   }
   timers.push(setTimeout(()=>res.write(sse({content:wire.slice(0,100)})),150));
   timers.push(setTimeout(()=>{res.write(sse({content:wire.slice(100)}));if(mode==='success')res.write(sse({},'stop')+'data: [DONE]\n\n');res.end();},1800));
  });
 });
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.DETWEAVE_CHROME?{executablePath:process.env.DETWEAVE_CHROME}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const out=path.resolve('local/browser-stream');fs.mkdirSync(out,{recursive:true});
 try{
  await page.goto(process.env.DETWEAVE_URL || 'http://127.0.0.1:8765');
  await page.waitForFunction(()=>!document.querySelector('#export').disabled);
  await page.selectOption('#examples','sampling');await page.waitForFunction(()=>!document.querySelector('#export').disabled);
  await page.selectOption('#provider','openai');
  await page.fill('#base-url',`http://127.0.0.1:${provider.address().port}/v1`);await page.fill('#model-name','synthetic');
  const original=await page.inputValue('#model-json');
  await page.click('#extract');
  await page.waitForFunction(()=>document.querySelector('#run-reasoning').textContent.includes('核对单位'));
  assert.equal(await page.inputValue('#model-json'),original,'Partial output replaced previous model');
  assert.equal(await page.locator('#run-reasoning img').count(),0,'Provider text executed as HTML');
  assert(await page.isDisabled('#export'));assert.equal(await page.locator('#run-stage').getAttribute('data-state'),'active');
  await page.screenshot({path:out+'/working.png',fullPage:true});
  await page.waitForFunction(()=>document.querySelector('#run-stage').dataset.state==='done');
  assert((await page.locator('#run-output').innerText()).includes('schema_version'));
  assert.equal(await page.locator('#run-reasoning').innerText(),'合成服务商测试片段：核对单位与层数。<img src=x onerror=alert(1)>');
  assert(await page.isDisabled('#run-cancel'));
  await page.click('#run-close');assert(!(await page.locator('#run-monitor').isVisible()));
  await page.click('#run-toggle');assert(await page.locator('#run-monitor').isVisible());await page.click('#run-close');
  const saved=await page.evaluate(()=>JSON.stringify(projectDocument()));assert(!saved.includes('合成服务商测试片段'));
  mode='cancel';const beforeCancel=await page.inputValue('#model-json');
  await page.click('#extract');await page.waitForFunction(()=>document.querySelector('#run-reasoning').textContent.includes('核对单位'));
  await page.click('#run-cancel');await page.waitForFunction(()=>document.querySelector('#run-stage').dataset.state==='cancelled');
  assert.equal(await page.inputValue('#model-json'),beforeCancel);
  const until=Date.now()+3000;while(active.size && Date.now()<until)await sleep(50);
  assert.equal(active.size,0,'Cancellation did not close upstream connection');await page.click('#run-close');
  mode='truncated';await page.click('#extract');await page.waitForFunction(()=>document.querySelector('#run-stage').dataset.state==='failed');
  assert.equal(await page.inputValue('#model-json'),beforeCancel);
  assert((await page.locator('#run-log').innerText()).includes('incomplete_response'));
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/mobile.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
  console.log('Streaming UI passed: early thinking/JSON, escaped text, result-only commit, local-only trace, close/reopen, cancellation closes upstream, truncated stream rejected, mobile.');
 }finally{await browser.close();for(const res of active)res.destroy();await new Promise(r=>provider.close(r));}
})().catch(e=>{console.error(e);process.exit(1);});
