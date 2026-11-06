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
const fps = 6;

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
  const page = await browser.newPage({ viewport: { width: 1160, height: 880 }, acceptDownloads: true });
  const requests = [];
  const errors = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(address);
  await page.waitForFunction(() => !document.querySelector("#export").disabled);
  const fixtureTitle = await page.locator("#geometry-subtitle").innerText();
  const fixtureSource = await page.inputValue("#source-text");
  await page.selectOption("#language", lang);
  assert.equal(await page.locator("html").getAttribute("lang"), lang);
  assert.equal(await page.locator("#main-title").innerText(), english ? "Detector geometry workbench" : "探测器几何工作台");
  assert.equal(await page.locator("#geometry-subtitle").innerText(), fixtureTitle);
  assert.equal(await page.inputValue("#source-text"), fixtureSource);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#export").disabled);
  assert.equal(await page.locator("html").getAttribute("lang"), lang);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ["detweave.language"]);
  assert((await page.locator("#provider option").count()) >= 14);
  await page.selectOption("#provider", "ark-coding");
  assert.equal(await page.inputValue("#base-url"), "https://ark.cn-beijing.volces.com/api/coding/v3");
  assert(await page.locator('#ark-model-select option[value="ark-code-latest"]').count());
  await page.selectOption("#provider", "demo");

  await page.evaluate(() => {
    const caption = document.createElement("div");
    caption.id = "demo-caption";
    caption.style.cssText = "position:fixed;z-index:20;bottom:10px;left:13px;max-width:52%;border:1px solid #43877e;"
      + "padding:7px 10px;background:#0b2030;color:#c2fff2;border-radius:6px;font:600 12px/1.4 system-ui;pointer-events:none";
    document.body.append(caption);
  });
  const prefix = english ? "OFFLINE SYNTHETIC DEMO" : "离线合成示例";
  const caption = (en, zh) => page.locator("#demo-caption").evaluate((node, text) => { node.textContent = text; },
    prefix + "  /  " + (english ? en : zh));
  const frames = path.join(temporary, lang);
  fs.mkdirSync(frames);
  let frame = 0;
  async function shot(repeat = 1) {
    if (checkOnly) return;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const image = await page.screenshot();
    for (let i = 0; i < repeat; i++) fs.writeFileSync(path.join(frames, String(++frame).padStart(4, "0") + ".png"), image);
  }

  const title = english ? "Synthetic sampling demo" : "合成采样演示";
  await page.selectOption("#project-menu", "__new__");
  await page.fill("#project-create-name", title);
  assert(await page.isDisabled("#project-create-submit"), "Project creation must require an explicit location");
  await page.waitForSelector('#project-create-location option[value="default"]', { state: "attached" });
  const locations = await page.evaluate(async () => (await fetch("/api/projects/locations")).json());
  if (locations.capabilities?.system_picker) assert(await page.isVisible("#project-location-browse"));
  const parentFolder = path.join(temporary, lang + "-workspace");
  fs.mkdirSync(parentFolder);
  await page.locator("#project-location-register > summary").click();
  await page.fill("#project-location-path-input", parentFolder);
  await page.click("#project-location-register-button");
  await page.waitForFunction(() => document.querySelector("#project-create-location").value
    && !document.querySelector("#project-create-submit").disabled);
  await caption("Choose a parent folder and create a project", "选择父目录并新建项目");
  await shot(9);
  await page.click("#project-create-submit");
  await page.waitForFunction(() => !document.querySelector("#project-create-dialog").open);
  assert.equal(await page.inputValue("#project-title-input"), title);
  assert((await page.locator("#project-folder").innerText()).startsWith(fs.realpathSync(parentFolder) + path.sep));
  await page.selectOption("#project-menu", "__new__");
  assert.equal(await page.inputValue("#project-create-location"), "");
  const locationChoices = await page.locator("#project-create-location").innerText();
  assert(locationChoices.includes(english ? "Last used" : "上次使用"));
  await page.click("#project-create-cancel");

  await page.selectOption("#examples", "sampling");
  await page.waitForFunction(() => !document.querySelector("#export").disabled);
  await caption("Load a four-period tungsten / silicon fixture", "加载四周期钨／硅合成采样几何");
  await shot(12);
  const source = await page.inputValue("#source-text");
  const canvas = await page.locator("#scene").boundingBox();
  const [x, y] = [canvas.x + canvas.width / 2, canvas.y + canvas.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await caption("Orbit the 3D geometry", "旋转三维几何");
  for (let i = 1; i <= 13; i++) {
    await page.mouse.move(x + i * 12, y - i * 4);
    await shot();
  }
  await page.mouse.up();
  await shot(4);

  await page.click('[data-view="xz"]');
  await caption("Review an orthographic projection", "查看正交投影与尺寸");
  await shot(10);
  await page.click("#extract");
  await page.waitForFunction(() => document.querySelector("#run-stage").dataset.state === "done");
  assert.equal(await page.locator("#run-reasoning").textContent(), "");
  await caption("Run the fixed fixture locally; no model call", "固定示例提取，全程不调用模型");
  await shot(11);
  await page.click("#run-close");

  await page.fill("#project-title-input", title + (english ? " · reviewed" : " · 已审阅"));
  await page.fill("#source-text", source + (english
    ? "\n\nSynthetic review note: check the layer centers in the XZ projection."
    : "\n\n合成审阅备注：在 XZ 投影中核对各层中心。"));
  await page.click("#project-save");
  await page.waitForFunction(() => document.querySelector("#project-history-count").textContent.includes("2"));
  await page.locator("#project-history > summary").click();
  await caption("Save a second prompt version and inspect run history", "保存第二版讨论并检查提取记录");
  await shot(13);
  assert(await page.locator("#project-prompts [data-project-prompt]").count() === 2);
  assert(await page.locator("#project-runs [data-project-run]").count() === 1);

  await page.click("#project-runs [data-project-run]");
  await page.waitForFunction(() => !document.querySelector("#export").disabled);
  await page.locator("#project-history > summary").click();
  const downloadEvent = page.waitForEvent("download");
  await page.click("#export");
  const archive = await downloadEvent;
  assert.match(archive.suggestedFilename(), /\.zip$/);
  await caption("Restore the recorded geometry and export a ZIP", "恢复记录中的几何并导出 ZIP");
  await shot(12);

  await page.click("#about-open");
  assert.match(await page.locator("#about-dialog").innerText(), /李衡讷 \/ Hengne Li/);
  assert.match(await page.locator("#about-dialog").innerText(), /Hengne\.Li@cern\.ch/);
  await page.keyboard.press("Escape");
  await page.locator("#demo-caption").evaluate((node) => node.remove());
  await page.evaluate(() => window.scrollTo(0, 0));
  if (qa) await page.screenshot({ path: path.join(qa, lang + "-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile layout overflow");
  if (qa) await page.screenshot({ path: path.join(qa, lang + "-mobile.png"), fullPage: true });
  const projectId = await page.inputValue("#project-menu");
  await page.fill("#source-text", source + "\n\nSynthetic input outside the fixed fixture.");
  await page.click("#extract");
  await page.waitForFunction(() => document.querySelector("#run-stage").dataset.state === "failed");
  await page.click("#run-close");
  await page.waitForFunction(() => document.querySelector("#project-history-count").textContent.includes("2 run")
    || document.querySelector("#project-history-count").textContent.includes("2 次运行"));
  const saved = await page.evaluate(async (id) => (await fetch("/api/projects/" + id)).json(), projectId);
  assert.equal(saved.runs[0].status, "failed");
  assert.equal(saved.prompts.length, 3);
  assert(requests.every((url) => new URL(url).origin === new URL(address).origin), "Demo made an external network request");
  assert.deepEqual(errors, []);
  await page.close();

  if (!checkOnly) {
    const sourceFrames = ["-framerate", String(fps), "-i", path.join(frames, "%04d.png")];
    const basename = path.join(output, "detweave-demo-" + (english ? "en" : "zh"));
    ffmpeg([...sourceFrames, "-c:v", "libx264", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", basename + ".mp4"]);
    ffmpeg([...sourceFrames, "-filter_complex", "[0:v]scale=980:-2,split[a][b];[a]palettegen=max_colors=112[p];[b][p]paletteuse=dither=bayer:bayer_scale=3", "-loop", "0", basename + ".gif"]);
  }
}

(async () => {
  const server = spawn(process.env.DETWEAVE_PYTHON || "python3", ["-m", "detweave", "serve", "--port", "0"], {
    cwd: root, env: { ...process.env, DETWEAVE_PROJECTS_DIR: path.join(temporary, "projects") },
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
    console.log("Bilingual desktop/mobile, local projects, provider menus, offline extraction, and export checks passed.");
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
