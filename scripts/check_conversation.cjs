/* Local-backend conversational workflow; fixtures only, no model credentials. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require(process.env.DETWEAVE_PLAYWRIGHT || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'detweave-chat-'));
  const out = path.join(root, 'local', 'conversation-qa');
  fs.mkdirSync(out, {recursive:true});
  const server = spawn(process.env.DETWEAVE_PYTHON || 'python3', ['-m', 'detweave', 'serve', '--dev-ui', '--port', '0'], {
    cwd:root, env:{...process.env, DETWEAVE_PROJECTS_DIR:storage, DETWEAVE_SETTINGS_DIR:path.join(storage,"settings")}, stdio:['ignore','pipe','pipe']
  });
  let logs = '', browser;
  server.stderr.on('data', chunk => { logs += chunk.toString(); });
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Backend startup timed out: ' + logs)), 20000);
      server.once('exit', code => { clearTimeout(timer); reject(new Error('Backend exited ' + code + ': ' + logs)); });
      server.stdout.on('data', chunk => {
        logs += chunk.toString();
        const match = logs.match(/http:\/\/127\.0\.0\.1:\d+/);
        if(match) { clearTimeout(timer); resolve(match[0]); }
      });
    });
    browser = await chromium.launch({headless:true, ...(process.env.DETWEAVE_CHROME ? {executablePath:process.env.DETWEAVE_CHROME} : {})});
    const context = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    const page = await context.newPage(), errors = [], foreign = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      requests.push(request.url());
      if (/^https?:/.test(request.url()) && !request.url().startsWith(origin + '/')) foreign.push(request.url());
    });
    const response = await page.goto(origin);
    assert(response.ok());
    const html = await response.text();
    assert(!/<script[^>]+src=/.test(html), 'Development document still depends on external scripts');
    assert(!/<link[^>]+href="[^\"]+\.css/.test(html), 'Development document still depends on external styles');
    assert(response.headers()['content-security-policy'].includes("script-src 'sha256-"));
    await page.waitForFunction(() => document.querySelector('#project-menu option[value="__new__"]') && !document.querySelector('#project-menu').disabled);
    await page.selectOption('#project-menu', '__new__');
    await page.fill('#project-create-name', 'Conversation QA 探测器');
    assert(await page.locator('#project-create-submit').isDisabled(), 'Creation must require a location');
    await page.selectOption('#project-create-location', 'default');
    await page.click('#project-create-submit');
    await page.waitForFunction(() => !document.querySelector('#project-create-dialog').open);
    const projects = await (await page.request.get(origin + '/api/projects')).json();
    assert.equal(projects.projects.length, 1);
    const projectId = projects.projects[0].id;
    const route = origin + '/api/projects/' + projectId + '/conversation';
    const snapshot = async () => (await page.request.get(route)).json();
    await page.waitForFunction(() => !document.querySelector('#chat-input').disabled);
    const fixtures = await (await page.request.get(origin + '/api/examples')).json();
    const send = async text => {
      await page.fill('#chat-input', text);
      const completed = page.waitForResponse(r => r.url() === route + '/stream' && r.request().method() === 'POST');
      await page.click('#chat-send');
      const result = await completed;
      assert.equal(result.status(), 200);
      await page.waitForFunction(() => !chatOperation && !state.busy);
      assert.equal(await page.inputValue('#chat-input'), '', 'Successful turn must clear the composer: ' + await page.locator('#chat-status').innerText());
      return snapshot();
    };
    await send(fixtures[0].text);
    let state = await snapshot();
    assert.equal(state.revisions.length, 1);
    assert.equal(state.messages.filter(m => m.role === 'user').length, 1);
    const first = state.current_revision_id;
    const initialModel = state.revisions.find(r => r.id === first).model;
    await send('请把这个探测器加厚一点，但我还没有确定具体数值。');
    state = await snapshot();
    assert.equal(state.revisions.length, 1, 'Clarification must not generate a revision');
    assert.equal(state.current_revision_id, first);
    await send('演示修改厚度');
    state = await snapshot();
    assert.equal(state.revisions.length, 2);
    assert.notEqual(state.current_revision_id, first);
    const second = state.revisions.find(r => r.id === state.current_revision_id);
    assert.equal(second.parent_id, first);
    assert.notDeepEqual(second.model, initialModel);
    assert.equal(state.messages.filter(m => m.role === 'user').length, 3);
    // Explicit human confirmation creates a trusted, immutable successor revision.
    const changedVolume = second.model.volumes.find(volume => volume.shape.type === 'box');
    const evidencePath = 'volumes.' + changedVolume.id + '.shape';
    assert.equal(second.model.evidence[evidencePath].status, 'assumed');
    await page.click('#tree [data-type="volume"][data-id="' + changedVolume.id + '"]');
    await page.click('[data-confirm="' + evidencePath + '"]');
    assert(await page.locator('#chat-confirmation').isVisible());
    assert.equal(await page.locator('#chat-confirmation-value').innerText(), evidencePath + ' = ' + JSON.stringify(changedVolume.shape));
    const confirmedResponse = page.waitForResponse(r => r.url() === route + '/confirm' && r.request().method() === 'POST');
    await page.click('#chat-confirm-accept');
    assert.equal((await confirmedResponse).status(), 200);
    await page.waitForFunction(() => document.querySelector('#chat-confirmation').hidden && !state.busy);
    state = await snapshot();
    assert.equal(state.revisions.length, 3);
    const confirmedId = state.current_revision_id;
    const confirmedRevision = state.revisions.find(r => r.id === confirmedId);
    assert.equal(confirmedRevision.parent_id, second.id);
    assert.equal(confirmedRevision.model.evidence[evidencePath].status, 'confirmed');
    assert.equal(state.revisions.find(r => r.id === second.id).model.evidence[evidencePath].status, 'assumed', 'Confirmation must not mutate the old revision');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#project-menu') && !document.querySelector('#project-menu').disabled);
    if (await page.inputValue('#project-menu') !== projectId) await page.selectOption('#project-menu', projectId);
    await page.waitForFunction(id => conversation.current_revision_id === id, confirmedId);
    state = await snapshot();
    assert.equal(state.revisions.find(r => r.id === confirmedId).model.evidence[evidencePath].status, 'confirmed');
    await page.selectOption('#revision-select', first);
    const acceptDialog = dialog => dialog.accept();
    page.on('dialog', acceptDialog);
    const restored = page.waitForResponse(r => r.url() === route + '/select' && r.request().method() === 'POST');
    await page.click('#revision-restore');
    assert.equal((await restored).status(), 200);
    await page.waitForFunction(first => document.querySelector('#revision-select').value === first, first);
    page.off('dialog', acceptDialog);
    state = await snapshot();
    assert.equal(state.current_revision_id, first);
    assert.deepEqual(state.revisions.find(r => r.id === first).model, initialModel);
    assert(await page.locator('#run-monitor').isHidden(), 'Thinking panel must stay hidden');
    assert(await page.locator('#run-toggle').isHidden(), 'Thinking entry must not occupy primary UI');
    await page.click('[data-artifact="preview"]');
    await page.click('[data-view="xz"]');
    assert(await page.locator('#drawing svg').count(), 'SVG projection must render');
    await page.click('[data-view="3d"]');
    assert(await page.locator('#scene').isVisible(), '3D canvas must be visible');
    await page.click('[data-artifact="code"]');
    assert((await page.locator('#artifact-json').innerText()).includes(initialModel.title));
    await page.click('[data-artifact="pdf"]');
    assert((await page.locator('#artifact-pdf').innerText()).length > 0, 'Unimplemented PDF must have an explicit explanation');
    await page.click('[data-artifact="preview"]');
    await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
    const messageCount = state.messages.length;
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#project-menu') && !document.querySelector('#project-menu').disabled);
    if (await page.inputValue('#project-menu') !== projectId) await page.selectOption('#project-menu', projectId);
    await page.waitForFunction(() => document.querySelector('#chat-messages').textContent.includes('演示修改厚度'));
    state = await snapshot();
    assert.equal(state.messages.length, messageCount);
    assert.equal(state.current_revision_id, first);
    // A manual IR edit is a revision before confirmation, never a local-only preview.
    const editedSize = await page.evaluate(async()=>{
      const edited=clone(state.model);edited.world.size_mm[0]+=500;
      jsonInput.value=JSON.stringify(edited);await applyModelJSON();
      return state.model.world.size_mm;
    });
    const manual = await snapshot();
    assert.deepEqual(manual.revisions.find(r=>r.id===manual.current_revision_id).model.world.size_mm,editedSize);
    const stale = await page.request.post(route+'/confirm',{headers:{'X-DetWeave':'1'},data:{revision_id:first,targets:['world.size_mm']}});
    assert.equal(stale.status(),409,'Stale confirmation must not approve different values');
    await page.evaluate(()=>prepareEvidenceConfirmation('world.size_mm',state.model.world.size_mm));
    await page.click('#chat-confirm-accept');
    await page.waitForFunction(()=>!state.busy && state.model.evidence['world.size_mm'].status==='confirmed');
    assert.deepEqual(await page.evaluate(()=>state.model.world.size_mm),editedSize);
    // A mismatched displayed preview cannot be confirmed as the stored version.
    const blocked = await page.evaluate(()=>{
      const before=clone(state.model);state.model.world.size_mm[0]+=1;
      try {prepareEvidenceConfirmation('world.size_mm',state.model.world.size_mm);return false;}
      catch {return true;}finally{state.model=before;}
    });
    assert(blocked);
    await page.selectOption('#language', 'en');
    assert.equal(await page.locator('#chat-send').innerText(), 'Send');
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile view overflows horizontally');
    await page.screenshot({path:path.join(out,'mobile.png')});
    await page.locator('#chat-input').scrollIntoViewIfNeeded();
    assert(await page.locator('#chat-input').isVisible());
    await page.screenshot({path:path.join(out,'mobile-composer.png')});
    const detachedPath = path.join(out, 'DetWeave-dev-detached.html');
    fs.writeFileSync(detachedPath, html);
    const detached = await context.newPage(), detachedNetwork = [];
    detached.on('request', request => {if (/^https?:/.test(request.url())) detachedNetwork.push(request.url());});
    await detached.goto('file://' + detachedPath);
    assert((await detached.locator('body').innerText()).includes('Local backend') || (await detached.locator('body').innerText()).includes('local backend'));
    assert.deepEqual(detachedNetwork, [], 'Detached development HTML must not make network requests');
    await detached.close();
    assert.deepEqual(foreign, [], 'Browser must only request its local backend');
    assert.deepEqual(errors, [], 'Browser execution errors');
    fs.writeFileSync(path.join(out,'result.json'), JSON.stringify({passed:true,origin,requests:requests.length,revisions:state.revisions.length,messages:state.messages.length,foreign,errors},null,2));
    console.log('Conversation PASS: single-document local backend, explicit project location, fixture generation, clarification retains geometry, revision parentage, trusted confirmation card/persistence, restore, reload, SVG/3D/code/PDF notice, bilingual/mobile, no remote browser calls.');
  } finally {
    if(browser) await browser.close();
    server.kill('SIGTERM');
    await new Promise(resolve => { if(server.exitCode !== null) resolve(); else {server.once('exit', resolve); setTimeout(resolve,3000).unref();} });
    fs.rmSync(storage, {recursive:true,force:true});
  }
})().catch(error => {console.error(error); process.exitCode=1;});
