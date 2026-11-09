/* npm install --no-save playwright && npx playwright install chromium
 * Optional: DETWEAVE_PLAYWRIGHT, DETWEAVE_CHROME, DETWEAVE_PYTHON, DETWEAVE_FFMPEG,
 * DETWEAVE_DEMO_QA_DIR (save final desktop/mobile screenshots).
 * Run from the checkout: node scripts/record_demo.cjs [--check-only]
 */
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.DETWEAVE_PLAYWRIGHT || "playwright");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "docs", "media");
const checkOnly = process.argv.includes("--check-only");
const temporary = fs.mkdtempSync(path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "detweave-demo-"));
const qa = process.env.DETWEAVE_DEMO_QA_DIR;
const fps = 4;

function listen(server) {
  return new Promise((resolve, reject) => {
    let startup = "";
    const timeout = setTimeout(() => reject(new Error("Local demo server did not start.")), 10_000);
    server.stdout.on("data", (chunk) => {
      startup += chunk.toString();
      const address = startup.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (address) { clearTimeout(timeout); resolve(address); }
    });
    server.on("error", (error) => { clearTimeout(timeout); reject(error); });
    server.on("exit", (code) => { clearTimeout(timeout); reject(new Error("Demo server exited: " + code)); });
  });
}

function ffmpeg(args) {
  const result = spawnSync(process.env.DETWEAVE_FFMPEG || "ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("FFmpeg exited: " + result.status);
}

async function capture(browser, address, lang) {
  const english = lang === "en";
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, acceptDownloads: true });
  const requests = [], errors = [];
  page.on("request", r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(address);
  await page.waitForFunction(() => window.detweaveProviderSettingsReady && !document.querySelector('#project-menu').disabled);
  await page.selectOption('#language', lang);
  assert.equal(await page.locator('html').getAttribute('lang'),lang);
  await page.evaluate(() => {
    const caption=document.createElement('div');caption.id='demo-caption';
    caption.style.cssText='position:fixed;z-index:10000;bottom:12px;left:14px;right:14px;border:1px solid #43877e;padding:10px 14px;background:#0b2030ee;color:#c2fff2;border-radius:8px;font:600 16px/1.5 system-ui;pointer-events:none';
    document.body.append(caption);
  });
  const prefix=english?'OFFLINE SYNTHETIC DEMO — NO MODEL API CALL':'离线合成演示 — 不调用模型 API';
  const caption=async(en,zh)=>page.locator('#demo-caption').evaluate((n,t)=>n.textContent=t,prefix+'  /  '+(english?en:zh));
  const frames=path.join(temporary,lang);fs.mkdirSync(frames);let frame=0;
  async function shot(seconds=2) {
    if(checkOnly)return;
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    const image=await page.screenshot();
    for(let i=0;i<Math.max(1,Math.round(seconds*fps));i++)fs.writeFileSync(path.join(frames,String(++frame).padStart(4,'0')+'.png'),image);
  }
  await caption('Create a named project and choose where to store it','新建命名项目，并选择保存位置');
  await page.selectOption('#project-menu','__new__');
  await page.fill('#project-create-name',english?'Conversation sampling demo':'对话式采样几何演示');
  assert(await page.isDisabled('#project-create-submit'));
  await page.selectOption('#project-create-location','default');
  await shot(2.5);
  await page.click('#project-create-submit');
  await page.waitForFunction(()=>!document.querySelector('#project-create-dialog').open);
  const id=await page.inputValue('#project-menu');
  const route='/api/projects/'+id+'/conversation';
  const snapshot=async()=>await page.evaluate(async(route)=>(await fetch(route)).json(),route);
  const frameWorkbench=async()=>page.locator('.workbench').evaluate(n=>window.scrollTo(0,n.getBoundingClientRect().top+scrollY-20));
  await frameWorkbench();
  await page.locator('.chat-settings > summary').click();
  await page.selectOption('#provider','demo');
  await page.selectOption('#examples','sampling');
  await caption('Load a fixed tungsten/silicon example into the conversation','将固定钨／硅示例放入对话输入框');
  await shot(2.5);
  await page.locator('.chat-settings > summary').click();
  const send=async(text)=>{
    if(text!==undefined)await page.fill('#chat-input',text);
    await page.click('#chat-send');
    await page.waitForFunction(()=>!chatOperation&&!state.busy&&document.querySelector('#chat-input').value==='');
    await frameWorkbench();
    return snapshot();
  };
  let doc=await send();assert.equal(doc.revisions.length,1);const first=doc.current_revision_id;
  await caption('Version 1: conversation on the left, geometry on the right','第 1 版：左侧对话，右侧同步显示几何');
  await shot(3);
  const canvas=await page.locator('#scene').boundingBox();
  const x=canvas.x+canvas.width/2,y=canvas.y+canvas.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await caption('Rotate the 3D geometry to inspect the layers','旋转三维几何，观察层结构');
  for(let i=1;i<=12;i++){await page.mouse.move(x+i*9,y-i*3);await shot(1/fps);}
  await page.mouse.up();await shot(1);
  await page.click('[data-view="xz"]');
  await caption('Inspect the SVG orthographic projection','检查 SVG 正交投影');await shot(2);
  await page.fill('#chat-input',english?'Make the layers thicker; the exact value is not decided yet.':'把层加厚一点，具体数值还没确定。');
  await caption('An unclear follow-up must not silently replace the geometry','不明确的补充要求，不应静默替换当前几何');await shot(2);
  doc=await send();assert.equal(doc.revisions.length,1);assert.equal(doc.current_revision_id,first);
  await caption('Demo clarification retains v1; free-text understanding needs a real model','演示澄清保留 v1；自由文本理解需要真实模型');await shot(3);
  await page.fill('#chat-input',english?'demo change thickness':'演示修改厚度');
  await caption('Send the explicit synthetic thickness-edit command','发送明确标记的合成厚度修改命令');await shot(2);
  doc=await send();assert.equal(doc.revisions.length,2);assert.equal(doc.revisions[1].parent_id,first);
  await page.locator('#revision-diff > summary').click();
  await caption('Version 2 records the exact parameter change and its parent','第 2 版记录实际参数差异与父版本');await shot(3);
  await page.locator('#revision-diff > summary').click();
  await page.selectOption('#revision-select',first);
  await caption('Select an earlier revision; history is preserved','选择早期版本，已有历史继续保留');await shot(2);
  await page.click('#revision-restore');
  await page.waitForFunction(id=>conversation.current_revision_id===id&&!state.busy,first);
  assert.equal((await snapshot()).revisions.length,2);
  await caption('Restore v1 and continue designing from it','恢复 v1，并可从它继续设计');await shot(3);
  await page.click('[data-view="3d"]');
  await caption('Dialogue, geometry versions and exports stay in the local project','对话、几何版本与导出均保存在本机项目中');await shot(3);
  const saved=await snapshot();assert(saved.messages.length>=7);
  assert(requests.every(url=>new URL(url).origin===new URL(address).origin));assert.deepEqual(errors,[]);
  if(qa)await page.screenshot({path:path.join(qa,lang+'-desktop.png')});
  await page.locator('#demo-caption').evaluate(n=>n.remove());
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(qa)await page.screenshot({path:path.join(qa,lang+'-mobile.png')});
  await page.close();
  if(!checkOnly){
    const sourceFrames=['-framerate',String(fps),'-i',path.join(frames,'%04d.png')];
    const basename=path.join(output,'detweave-demo-'+(english?'en':'zh'));
    ffmpeg([...sourceFrames,'-c:v','libx264','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',basename+'.mp4']);
    ffmpeg([...sourceFrames,'-filter_complex','[0:v]scale=1000:-2,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4','-loop','0',basename+'.gif']);
  }
}

(async () => {
  const server = spawn(process.env.DETWEAVE_PYTHON || "python3", ["-m", "detweave", "serve", "--dev-ui", "--port", "0"], {
    cwd: root, env: { ...process.env, DETWEAVE_PROJECTS_DIR: path.join(temporary, "projects"), DETWEAVE_SETTINGS_DIR:path.join(temporary,"settings") },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let browser;
  try {
    const address = await listen(server);
    browser = await chromium.launch({ headless: true,
      ...(process.env.DETWEAVE_CHROME ? { executablePath: process.env.DETWEAVE_CHROME } : {}) });
    if (!checkOnly) fs.mkdirSync(output, { recursive: true });
    if (qa) fs.mkdirSync(qa, { recursive: true });
    for (const lang of ["zh-CN", "en"]) await capture(browser, address, lang);
    console.log("Bilingual conversation recording passed: named project/location, fixture, clarification, thickness revision, restore, SVG/3D, no external model calls.");
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await stopped;
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
