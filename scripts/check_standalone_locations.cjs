/* Build the standalone HTML first with python3 scripts/build_standalone.py.
 * npm install --no-save playwright && npx playwright install chromium
 * Usage: node scripts/check_standalone_locations.cjs [path/to/DetWeave.html]
 * Optional: DETWEAVE_PLAYWRIGHT and DETWEAVE_CHROME.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.DETWEAVE_PLAYWRIGHT || "playwright");

const htmlPath = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist", "DetWeave-0.2.0.html"));
const settings = { acceptDownloads: true, viewport: { width: 1180, height: 850 } };

async function ready(page, address) {
  await page.goto(address);
  await waitForReady(page);
}

async function waitForReady(page) {
  await page.waitForFunction(() => window.DetWeavePortable && document.querySelector("#export")?.disabled === false);
}

async function newProject(page, title) {
  await page.selectOption("#project-menu", "__new__");
  await page.fill("#project-create-name", title);
  assert(await page.isDisabled("#project-create-submit"), "An explicit location is required");
  await page.waitForSelector('#project-create-location option[value="default"]', { state: "attached" });
  assert(await page.isHidden("#project-location-register"), "Standalone mode must not request an absolute path");
}

async function createProject(page) {
  await page.click("#project-create-submit");
  await page.waitForFunction(() => !document.querySelector("#project-create-dialog").open
    || document.querySelector("#project-create-error").textContent);
  assert.equal(await page.locator("#project-create-error").textContent(), "");
}

async function checkDirectFile(browser) {
  const context = await browser.newContext({ ...settings, offline: true });
  try {
    const page = await context.newPage();
    const errors = [];
    const network = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await ready(page, pathToFileURL(htmlPath).href);
    await page.selectOption("#language", "en");
    assert.equal(await page.locator(".identity").getAttribute("href"), "#main-title");
    const schemaEvent = page.waitForEvent("download");
    await page.click("#schema-link");
    const schema = await schemaEvent;
    assert.equal(schema.suggestedFilename(), "detweave-schema.json");
    assert(JSON.parse(await fs.readFile(await schema.path(), "utf8")).properties.world);
    await newProject(page, "Offline browser library");
    await page.selectOption("#project-create-location", "default");
    await createProject(page);
    assert.match(await page.locator("#project-folder").innerText(), /^Browser project library/);
    const id = await page.inputValue("#project-menu");
    await page.reload();
    await waitForReady(page);
    await page.waitForFunction((projectId) => [...document.querySelector("#project-menu").options]
      .some((option) => option.value === projectId), id);
    await page.selectOption("#project-menu", id);
    await page.waitForFunction(() => document.querySelector("#project-title-input").value === "Offline browser library", null, { timeout: 5000 })
      .catch(async (error) => {
        throw new Error("Could not reopen the offline project: " + await page.locator("#project-message").textContent(), { cause: error });
      });
    await page.selectOption("#language", "zh-CN");
    assert.match(await page.locator("#project-folder").innerText(), /^浏览器项目库/);
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
  } finally {
    await context.close();
  }
}

async function checkDirectoryMirror(browser, address) {
  // Chromium may deny OPFS on file://. Serve only the exact HTML on a secure
  // loopback origin, then disable networking. There is no DetWeave API server.
  const context = await browser.newContext(settings);
  try {
    await context.addInitScript(() => {
      window.showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle("qa-picked-folder", { create: true });
      };
      const queryPermission = FileSystemHandle.prototype.queryPermission;
      FileSystemHandle.prototype.queryPermission = function (options) {
        if (window.qaRevokeFolder && this.name === "qa-picked-folder") return Promise.resolve("denied");
        return queryPermission.call(this, options);
      };
    });
    const page = await context.newPage();
    const errors = [];
    const network = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await ready(page, address);
    await context.setOffline(true);
    await page.selectOption("#language", "en");
    await newProject(page, "QA picked location");
    assert(await page.isVisible("#project-location-browse"));
    await page.click("#project-location-browse");
    await page.waitForFunction(() => !document.querySelector("#project-create-submit").disabled
      || document.querySelector("#project-create-error").textContent);
    assert.equal(await page.locator("#project-create-error").textContent(), "");
    assert.equal(await page.locator("#project-create-location-path").innerText(), "qa-picked-folder");
    await createProject(page);
    const pickedProjectId = await page.inputValue("#project-menu");
    const location = await page.locator("#project-folder").innerText();
    assert.match(location, /^qa-picked-folder\/QA picked location -- [0-9a-f]{32}$/);

    await page.selectOption("#examples", "sampling");
    await page.waitForFunction(() => !document.querySelector("#export").disabled);
    await page.click("#extract");
    await page.waitForFunction(() => document.querySelector("#run-stage").dataset.state === "done");
    await page.click("#run-close");
    const zipEvent = page.waitForEvent("download");
    await page.click("#export");
    assert.equal((await zipEvent).suggestedFilename(), "detweave-geometry.zip");

    const files = await page.evaluate(async (folderPath) => {
      const root = await navigator.storage.getDirectory();
      const [parent, name] = folderPath.split("/");
      const folder = await (await root.getDirectoryHandle(parent)).getDirectoryHandle(name);
      async function readJSON(directory, filename) {
        const file = await (await directory.getFileHandle(filename)).getFile();
        return JSON.parse(await file.text());
      }
      const children = [];
      for await (const entry of folder.keys()) children.push(entry);
      const runs = [];
      for await (const run of (await folder.getDirectoryHandle("runs")).values()) {
        runs.push(await readJSON(await run.getDirectoryHandle("outcome"), "outcome.json"));
      }
      const exports = [];
      for await (const record of (await folder.getDirectoryHandle("exports")).values()) {
        for await (const entry of record.keys()) exports.push(entry);
      }
      return { children, metadata: await readJSON(folder, "project.json"), runs, exports };
    }, location);
    assert.deepEqual(files.children.sort(), ["exports", "project.json", "prompts", "runs"]);
    assert.equal(files.metadata.title, "QA picked location");
    assert.equal(files.runs[0].status, "succeeded");
    assert(files.exports.some((file) => file.endsWith(".zip")));

    await page.evaluate(() => { window.qaRevokeFolder = true; });
    await newProject(page, "QA browser library");
    assert.match(await page.locator("#project-create-location").innerText(), /Last used/);
    await page.selectOption("#project-create-location", "default");
    await createProject(page);
    await page.fill("#source-text", "This browser-only project does not need folder permission.");
    await page.click("#project-save");
    await page.waitForFunction(() => document.querySelector("#project-message").textContent === "Local project saved.");
    assert.equal(await page.locator("#portable-storage-warning").count(), 0);

    async function diskProject(nextTitle) {
      return page.evaluate(async ({ folderPath, title }) => {
        const root = await navigator.storage.getDirectory();
        const [parent, name] = folderPath.split("/");
        const folder = await (await root.getDirectoryHandle(parent)).getDirectoryHandle(name);
        const handle = await folder.getFileHandle("project.json");
        const original = await (await handle.getFile()).text();
        if (title === undefined) return original;
        const changed = JSON.stringify({ ...JSON.parse(original), title });
        const writer = await handle.createWritable();
        await writer.write(changed);
        await writer.close();
        return changed;
      }, { folderPath: location, title: nextTitle });
    }

    await page.selectOption("#project-menu", pickedProjectId);
    await page.waitForFunction(() => document.querySelector("#project-title-input").value === "QA picked location");
    const originalOnDisk = await diskProject();
    await page.fill("#project-title-input", "Browser title while permission is denied");
    await page.click("#project-save");
    await page.waitForFunction(() => document.querySelector("#portable-storage-warning")?.textContent.includes("permission expired"));
    await page.waitForFunction(() => document.querySelector("#project-message").textContent === "Local project saved.");
    assert.equal(await diskProject(), originalOnDisk);

    await page.evaluate(() => { window.qaRevokeFolder = false; });
    const changedOnDisk = await diskProject("Edited outside DetWeave");
    await page.fill("#project-title-input", "Browser title after external conflict");
    await page.click("#project-save");
    await page.waitForFunction(() => document.querySelector("#portable-storage-warning")?.textContent.includes("changed outside this tab"));
    await page.waitForFunction(() => document.querySelector("#project-message").textContent === "Local project saved.");
    assert.equal(await diskProject(), changedOnDisk, "The externally edited project file must remain byte-identical");

    await context.setOffline(false);
    await page.reload();
    await waitForReady(page);
    await page.waitForFunction((projectId) => [...document.querySelector("#project-menu").options]
      .some((option) => option.value === projectId), pickedProjectId);
    await context.setOffline(true);
    await page.selectOption("#project-menu", pickedProjectId);
    await page.waitForFunction(() => document.querySelector("#project-title-input").value === "Browser title after external conflict");
    assert.equal(await diskProject(), changedOnDisk);
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile layout overflow");
    assert.deepEqual(errors, []);
    assert(network.every((url) => url === address || url === address + "favicon.ico"), "Standalone app requested an external or server-side API resource");
  } finally {
    await context.close();
  }
}

async function checkRestoredDirectoryRelink(browser, address) {
  async function openProfile() {
    const context = await browser.newContext(settings);
    await context.addInitScript(() => {
      window.showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle(window.qaPickedRoot || "qa-relinked-folder", { create: true });
      };
    });
    const page = await context.newPage();
    await ready(page, address);
    await page.selectOption("#language", "en");
    return { context, page };
  }

  const source = await openProfile();
  let backup;
  try {
    backup = await source.page.evaluate(async () => {
      const location = await window.DetWeaveSelectProjectFolder();
      const response = await fetch("/api/projects", {
        method: "POST", body: JSON.stringify({ title: "Project moved across profiles", location_id: location.id }),
      });
      const project = await response.json();
      const name = project.folder.split("/").at(-1);
      const root = await navigator.storage.getDirectory();
      const picked = await root.getDirectoryHandle("qa-relinked-folder");
      const folder = await picked.getDirectoryHandle(name);
      const bytes = [...new Uint8Array(await (await (await folder.getFileHandle("project.json")).getFile()).arrayBuffer())];
      return { project, name, bytes, archive: window.DetWeavePortable.call("snapshot") };
    });
  } finally {
    await source.context.close();
  }

  const target = await openProfile();
  try {
    const { page } = target;
    async function seedDisk(rootName, folderName, metadata) {
      await page.evaluate(async ({ rootName, folderName, metadata }) => {
        const root = await navigator.storage.getDirectory();
        const picked = await root.getDirectoryHandle(rootName, { create: true });
        const folder = await picked.getDirectoryHandle(folderName, { create: true });
        const stream = await (await folder.getFileHandle("project.json", { create: true })).createWritable();
        await stream.write(typeof metadata === "string" ? metadata : Uint8Array.from(metadata));
        await stream.close();
      }, { rootName, folderName, metadata });
    }
    const api = (route, body) => page.evaluate(async ({ route, body }) => {
      const response = await fetch(route, body ? { method: "POST", body: JSON.stringify(body) } : {});
      if (!response.ok) throw new Error(route + " returned " + response.status + ": " + await response.text());
      return response.json();
    }, { route, body });
    await seedDisk("qa-relinked-folder", backup.name, backup.bytes);
    await page.evaluate(async (archive) => {
      window.DetWeavePortable.call("restore", { archive });
      await window.DetWeavePortable.persist();
    }, backup.archive);
    await page.reload();
    await waitForReady(page);

    const projectPath = "/api/projects/" + backup.project.id;
    assert.match((await api(projectPath)).folder, /^Restored browser folder copy/);
    const selected = await page.evaluate(() => window.DetWeaveSelectProjectFolder());
    assert.equal(selected.id, backup.project.location_id, "Reconnecting must reuse the restored location ID");
    assert.equal((await api("/api/projects")).projects.length, 1, "No duplicate project may be imported");
    assert.equal((await api(projectPath)).folder, "qa-relinked-folder/" + backup.name);
    const renamed = await api(projectPath, { title: "Saved after reconnecting" });
    const diskTitle = await page.evaluate(async (name) => {
      const root = await navigator.storage.getDirectory();
      const picked = await root.getDirectoryHandle("qa-relinked-folder");
      const folder = await picked.getDirectoryHandle(name);
      return JSON.parse(await (await (await folder.getFileHandle("project.json")).getFile()).text()).title;
    }, backup.name);
    assert.equal(diskTitle, renamed.title);

    await seedDisk("qa-other-folder", backup.name, backup.bytes);
    await page.evaluate(() => { window.qaPickedRoot = "qa-other-folder"; });
    await assert.rejects(page.evaluate(() => window.DetWeaveSelectProjectFolder()), /already registered elsewhere/);
    const browserProject = await api("/api/projects", { title: "Browser-only", location_id: "default" });
    await seedDisk("qa-default-copy", "Duplicate -- " + browserProject.id, JSON.stringify({ schema_version: 1, id: browserProject.id }));
    await page.evaluate(() => { window.qaPickedRoot = "qa-default-copy"; });
    await assert.rejects(page.evaluate(() => window.DetWeaveSelectProjectFolder()), /already registered elsewhere/);
    assert.equal((await api("/api/projects")).projects.length, 2);
    assert.equal((await api("/api/projects/locations")).locations.length, 2, "Conflicting selections must not register a location");
  } finally {
    await target.context.close();
  }
}

(async () => {
  const html = await fs.readFile(htmlPath);
  const server = http.createServer((request, response) => {
    if (request.url !== "/") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.DETWEAVE_CHROME ? { executablePath: process.env.DETWEAVE_CHROME } : {}),
    });
    await checkDirectFile(browser);
    await checkDirectoryMirror(browser, "http://127.0.0.1:" + server.address().port + "/");
    await checkRestoredDirectoryRelink(browser, "http://127.0.0.1:" + server.address().port + "/");
    console.log("Standalone location QA passed: offline file, reload, Schema, locations, OPFS mirror, revoked permission, external conflicts, restored-folder relinking, duplicate rejection, ZIP, mobile.");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
