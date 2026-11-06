"use strict";

const $ = (id) => document.getElementById(id);
const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const sourceInput = $("source-text");
const jsonInput = $("model-json");
const saveKey = "detweave.project.v1";
const arkCodingBase = "https://ark.cn-beijing.volces.com/api/coding/v3";
const arkCodingModel = "ark-code-latest";
const state = {
  model: null, report: null, provenance: null, reviewPending: false,
  view: "3d", selection: null, busy: false, examples: [], jsonCommitted: "",
};
const history = [];
const colors = {
  G4_AIR: "#8c9eb4", G4_Galactic: "#657d99", G4_W: "#a394de",
  G4_Pb: "#8ea9e8", G4_Si: "#54d8be", G4_Al: "#a5bbd0",
  G4_Fe: "#a9a0af", G4_Cu: "#ecab74", G4_POLYSTYRENE: "#f4d283",
  G4_SILICON_DIOXIDE: "#74c4f1", G4_CESIUM_IODIDE: "#ef9abe",
  G4_PbWO4: "#cfb1ee",
};
const materialColor = (name) => colors[name] || "#9baec7";
const statusNames = {
  stated: "原文给定", confirmed: "已确认", derived: "推导待审",
  assumed: "待确认假设", unresolved: "待澄清", missing: "缺少依据",
};
const planes = { xz: [0, 2, "X", "Z"], yz: [1, 2, "Y", "Z"], xy: [0, 1, "X", "Y"] };
const number = (n) => Number.isInteger(n) ? String(n) : Number(n.toPrecision(8)).toString();
const vector = (values, separator = ", ") => values.map(number).join(separator);
const extent = (shape) => shape.type === "box"
  ? shape.size_mm.map((n) => n / 2)
  : [shape.rmax_mm, shape.rmax_mm, shape.length_mm / 2];
const instances = () => state.report?.instances || [];
const isDirty = () => Boolean(state.model && sourceInput.value !== state.model.source_text);
const jsonDirty = () => jsonInput.value !== state.jsonCommitted;
const schemaFailed = (report) => report.checks?.schema === "failed"
  || report.issues?.some((item) => ["schema", "nonfinite"].includes(item.code));

function notify(message, tone = "") {
  const status = $("status");
  status.className = ["status", tone].filter(Boolean).join(" ");
  status.textContent = message;
}

async function api(path, data, binary = false) {
  const options = { cache: "no-store" };
  if (data !== undefined) {
    options.method = "POST";
    options.headers = { "Content-Type": "application/json", "X-DetWeave": "1" };
    options.body = JSON.stringify(data);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error("无法连接本地服务，请检查 DetWeave 是否仍在运行。");
  }
  if (response.ok) return binary ? response.blob() : response.json();
  const result = await response.json().catch(() => null);
  const message = result?.error?.message || result?.error || result?.message || result?.detail;
  throw new Error(typeof message === "string" ? message : "本地服务返回 HTTP " + response.status);
}

function updateControls() {
  const hasModel = Boolean(state.model);
  const dirty = isDirty();
  const hasInstances = instances().length > 0;
  const disabled = {
    extract: !sourceInput.value.trim(), validate: !hasModel, undo: !history.length,
    clear: !hasModel && !sourceInput.value, "save-local": !hasModel && !sourceInput.value,
    "project-download": !hasModel && !sourceInput.value,
    export: !state.report?.ready || dirty || jsonDirty() || state.reviewPending, "svg-export": !hasInstances,
    "html-export": !hasInstances, "reset-view": state.view !== "3d",
    "apply-json": !jsonInput.value.trim(), "reset-json": !hasModel,
    examples: !state.examples.length,
  };
  for (const [id, inactive] of Object.entries(disabled)) $(id).disabled = state.busy || inactive;
  for (const id of ["import", "provider", "base-url", "model-name", "api-key"]) $(id).disabled = state.busy;
  sourceInput.readOnly = state.busy;
  jsonInput.readOnly = state.busy;
  $("dirty-label").textContent = dirty ? "有尚未应用的原文修改" : "";
  $("text-length").textContent = sourceInput.value.length.toLocaleString("zh-CN") + " 字符";
  const reason = dirty ? "原文已有修改，请提取或同步更新 IR。"
    : jsonDirty() ? "IR 编辑框有未应用的修改。请应用或还原。"
    : state.reviewPending ? "已记录答复，请修改 IR 并验证，或重新提取。"
      : state.report?.ready ? "可导出当前模型。Geant4 与 DD4hep 运行检查未执行。"
        : "几何通过结构、解析几何及证据检查后可导出。";
  $("export-help").textContent = reason;
  $("export").title = reason;
  for (const button of document.querySelectorAll("[data-confirm], [data-question-action]")) {
    button.disabled = state.busy || (dirty && button.dataset.questionAction !== "extract");
  }
}

async function run(label, work) {
  if (state.busy) return;
  state.busy = true;
  notify(label);
  updateControls();
  try {
    await work();
  } catch (error) {
    notify(error.message, "error");
  } finally {
    state.busy = false;
    updateControls();
  }
}

function snapshot() {
  return {
    model: state.model, report: state.report, provenance: state.provenance,
    reviewPending: state.reviewPending, text: sourceInput.value,
  };
}

function remember() {
  history.push(snapshot());
  if (history.length > 30) history.shift();
}

function commit({ model, report, provenance = null, text = model?.source_text || "", reviewPending = false }, saveUndo = true) {
  if (saveUndo) remember();
  const changedTitle = state.model?.title !== model?.title;
  Object.assign(state, { model, report, provenance, reviewPending });
  sourceInput.value = text;
  state.jsonCommitted = model ? JSON.stringify(model, null, 2) : "";
  jsonInput.value = state.jsonCommitted;
  $("json-error").textContent = "";
  if (!model) state.selection = null;
  else if (changedTitle || !selectionExists(state.selection)) {
    state.selection = instances()[0] ? { type: "instance", id: instances()[0].id } : { type: "world", id: "world" };
    scene.reset();
  }
  render();
}

function selectionExists(selection) {
  if (!selection || !state.model) return false;
  const collections = {
    instance: instances(),
    volume: state.model.volumes,
    placement: state.model.placements,
  };
  return selection.type === "world" || collections[selection.type]?.some((item) => item.id === selection.id);
}

function select(type, id) {
  state.selection = { type, id };
  renderTree();
  renderDetails();
  renderDrawing();
  scene.draw();
  updateControls();
}

function isSelected(item, selection = state.selection) {
  return Boolean(selection && (
    (selection.type === "instance" && item.id === selection.id)
    || (selection.type === "volume" && item.volume === selection.id)
    || (selection.type === "placement" && item.origin === selection.id)
  ));
}

function setProvider(event) {
  const choice = $("provider").value;
  const live = choice !== "demo";
  const ark = choice === "ark-coding";
  const model = $("model-name");
  if (event || ark) {
    $("base-url").value = ark ? arkCodingBase : "";
    model.value = ark ? arkCodingModel : "";
    $("api-key").value = "";
  }
  if (ark) model.setAttribute("list", "ark-coding-models");
  else model.removeAttribute("list");
  $("provider-fields").hidden = !live;
  const privacy = "提取时会将讨论原文发送到所选服务。密钥只保留在当前页面内存中。";
  if (ark) $("provider-help").textContent =
    "模型栏可输入任意模型 ID。ark-code-latest 是服务端路由别名，可用模型取决于账号权限。" + privacy;
  else $("provider-help").textContent = live ? privacy : "仅匹配内置合成示例，适合离线体验。";
}

function configuredProvider() {
  const choice = $("provider").value;
  if (choice === "demo") return { kind: choice };
  const ark = choice === "ark-coding";
  return {
    kind: ark ? "openai" : choice,
    base_url: $("base-url").value.trim() || (ark ? arkCodingBase : ""),
    model: $("model-name").value.trim() || (ark ? arkCodingModel : ""),
    api_key: $("api-key").value,
  };
}

function publicProvenance(value) {
  if (!value || typeof value !== "object") return null;
  const result = {};
  for (const key of ["provider", "model", "response_model", "prompt_version", "source_sha256"]) {
    if (typeof value[key] === "string") result[key] = value[key].slice(0, 300);
  }
  if (Number.isFinite(value.duration_s)) result.duration_s = value.duration_s;
  if (value.usage && typeof value.usage === "object") {
    result.usage = Object.fromEntries(Object.entries(value.usage)
      .filter(([key, count]) => /^[a-z_]{1,40}$/i.test(key) && typeof count === "number" && Number.isFinite(count)));
  }
  return result;
}

async function validated(model) {
  const result = await api("/api/validate", { model });
  const report = result.report || result;
  if (schemaFailed(report)) throw new Error(report.issues?.[0]?.message || "IR 结构校验失败。");
  return report;
}

async function extractGeometry(text) {
  const provider = configuredProvider();
  if (!text.trim()) throw new Error("请输入设计讨论原文。");
  if (text.length > 30000) throw new Error("单次提取最多支持 30,000 字符。请拆分讨论。");
  if (provider.kind !== "demo" && !provider.model) throw new Error("请输入模型 ID。");
  if (provider.base_url && provider.kind !== "demo" && !$("base-url").validity.valid) {
    throw new Error("请填写有效的 Base URL。");
  }
  const result = await api("/api/extract", { text, provider });
  const report = result.report || await validated(result.model);
  if (schemaFailed(report)) throw new Error(report.issues?.[0]?.message || "提取结果的 IR 结构无效。");
  commit({ model: result.model, report, provenance: publicProvenance(result.provenance) });
  notify(report.ready ? "已提取并通过当前导出检查。" : "已提取草稿。请核对待审项目。", "success");
}

function nodeButton(type, id, meta, symbol, label = id) {
  const active = state.selection?.type === type && state.selection.id === id;
  return '<button type="button" data-type="' + esc(type) + '" data-id="' + esc(id)
    + '" aria-pressed="' + active + '"><span class="node-dot" aria-hidden="true">' + symbol
    + '</span><span class="mono">' + esc(label) + '</span><small>' + esc(meta) + '</small></button>';
}

function renderTree() {
  const tree = $("tree");
  const model = state.model;
  $("counts").textContent = instances().length + " 实例";
  if (!model) {
    tree.innerHTML = '<p class="empty-text">当前没有几何模型。</p>';
    return;
  }
  const children = new Map();
  for (const item of instances()) {
    if (!children.has(item.parent)) children.set(item.parent, []);
    children.get(item.parent).push(item);
  }
  function branches(id) {
    const items = (children.get(id) || []).map((item) =>
      '<li>' + nodeButton("instance", item.id, item.shape.type, "◇") + branches(item.id) + '</li>').join("");
    return items ? "<ul>" + items + "</ul>" : "";
  }
  const unexpanded = instances().length ? "" : model.placements.map((item) =>
    '<li>' + nodeButton("placement", item.id, "未展开", "◇") + "</li>").join("");
  const definitions = model.volumes.map((item) => '<li>' + nodeButton("volume", item.id, item.shape.type, "□") + "</li>").join("");
  tree.innerHTML = '<ul><li>' + nodeButton("world", "world", "根节点", "◎")
    + branches("world") + (unexpanded ? "<ul>" + unexpanded + "</ul>" : "") + '</li></ul>'
    + (definitions ? '<p class="tree-divider">体积定义 · ' + model.volumes.length + '</p><ul>' + definitions + "</ul>" : "");
}

function fieldsFor(model) {
  const fields = new Map();
  function add(prefix, object, entries) {
    for (const [key, label] of entries) {
      if (Object.hasOwn(object, key)) fields.set(prefix + "." + key, { value: object[key], label });
    }
  }
  add("world", model.world, [["size_mm", "World 尺寸"], ["material", "World 材料"]]);
  for (const volume of model.volumes) {
    add("volumes." + volume.id, volume, [["shape", "形状与尺寸"], ["material", "材料"]]);
  }
  for (const item of model.placements) {
    add("placements." + item.id, item, [
      ["volume", "体积引用"], ["parent", "父放置"], ["position_mm", "局部坐标"], ["repeat", "重复阵列"],
    ]);
  }
  return fields;
}

function evidenceCards(prefixes) {
  const model = state.model;
  return [...fieldsFor(model)].filter(([path]) => prefixes.some((prefix) => path.startsWith(prefix + ".")))
    .map(([path, field]) => {
      const entry = model.evidence[path];
      const validQuote = entry?.quote.trim() && model.source_text.includes(entry.quote);
      const acceptable = validQuote && ["stated", "confirmed"].includes(entry.status);
      const kind = entry?.status || "missing";
      return '<details class="evidence"' + (acceptable ? "" : " open") + '><summary>' + esc(field.label)
        + ' <span class="badge ' + esc(kind) + '">' + esc(statusNames[kind]) + "</span></summary>"
        + '<p class="issue-path">' + esc(path) + "</p>"
        + (entry?.quote ? '<blockquote>' + esc(entry.quote) + '</blockquote>' : '<p class="muted">暂无原文引句。</p>')
        + (entry?.note ? '<p class="muted">' + esc(entry.note) + '</p>' : "")
        + (entry?.quote && !validQuote ? '<p class="error">引句未出现在原文中。</p>' : "")
        + (acceptable ? "" : '<button type="button" class="text-button" data-confirm="' + esc(path) + '">记录此值已确认</button>')
        + "</details>";
    }).join("");
}

function renderDetails() {
  const pane = $("details");
  const model = state.model;
  const selection = state.selection;
  if (!selectionExists(selection)) {
    $("selection-kind").textContent = "—";
    pane.innerHTML = '<p class="empty-text">选中结构或投影中的对象，查看尺寸、材料和证据。</p>';
    return;
  }
  const world = selection.type === "world";
  const instance = selection.type === "instance" ? instances().find((item) => item.id === selection.id) : null;
  const placement = model.placements.find((item) => item.id === (instance?.origin || (selection.type === "placement" && selection.id)));
  const volumeId = selection.type === "volume" ? selection.id : placement?.volume;
  const volume = model.volumes.find((item) => item.id === volumeId);
  const shape = world ? { type: "box", size_mm: model.world.size_mm } : volume?.shape;
  const values = [];
  const prefixes = [];
  if (world) prefixes.push("world");
  if (volume) prefixes.push("volumes." + volume.id);
  if (shape?.type === "box") values.push(["盒体 XYZ", vector(shape.size_mm, " × ") + " mm"]);
  if (shape?.type === "tube") values.push(
    ["内半径", number(shape.rmin_mm) + " mm"], ["外半径", number(shape.rmax_mm) + " mm"],
    ["Z 全长", number(shape.length_mm) + " mm"],
  );
  if (world || volume) values.push(["材料", world ? model.world.material : volume.material]);
  if (placement) {
    prefixes.push("placements." + placement.id);
    values.push(["体积定义", placement.volume], ["父放置", placement.parent],
      ["局部坐标", "(" + vector(instance?.position_mm || placement.position_mm) + ") mm"]);
    if (instance) values.push(["世界坐标", "(" + vector(instance.global_mm) + ") mm"]);
    if (placement.repeat) values.push(["重复 / 步进", placement.repeat.count + " / (" + vector(placement.repeat.step_mm) + ") mm"]);
  }
  const kinds = { world: "世界", instance: "实例", volume: "定义", placement: "放置" };
  $("selection-kind").textContent = kinds[selection.type];
  pane.innerHTML = '<h4>' + esc(selection.id) + '</h4><dl class="param-list">'
    + values.map(([key, value]) => "<dt>" + esc(key) + "</dt><dd>" + esc(value) + "</dd>").join("")
    + "</dl>" + evidenceCards(prefixes);
}

const issueNames = {
  schema: "IR 结构", nonfinite: "非有限数值", identifier: "标识符", radius: "半径关系",
  reference: "引用", repeated_parent: "重复父放置", hierarchy: "层级", empty: "无放置",
  unused: "体积未放置", evidence_missing: "缺少依据", unconfirmed: "待确认",
  source_mismatch: "原文不匹配", derivation_review: "推导待审", outside_parent: "越界",
  overlap: "相交", overlap_summary: "相交汇总",
};

function renderIssues() {
  const report = state.report;
  const pane = $("issues");
  $("issue-count").textContent = report ? report.issues.length + " 项" : "—";
  if (!report) {
    pane.innerHTML = '<p class="empty-text">提取或导入模型后显示验证结果。</p>';
    return;
  }
  const questions = state.model.questions.map((question, index) =>
    '<article class="issue"><span class="badge blocker">待澄清</span> <span class="issue-path">'
    + esc(question.id) + '</span><p>' + esc(question.question) + '</p>'
    + (question.targets.length ? '<p class="issue-path">' + esc(question.targets.join(" · ")) + '</p>' : "")
    + '<textarea id="answer-' + index + '" maxlength="2000" aria-label="答复 ' + esc(question.id)
    + '" placeholder="填写设计方的答复"></textarea><div class="issue-actions">'
    + '<button type="button" class="button compact" data-question-action="extract" data-index="' + index + '">补充并提取</button>'
    + '<button type="button" class="button compact quiet" data-question-action="record" data-index="' + index
    + '" title="记录答复并移出问题。仍需修改 IR 或重新提取。">记录答复</button></div></article>');
  const issues = report.issues.filter((item) => item.code !== "clarification").map((item) =>
    '<article class="issue"><span class="badge ' + esc(item.level) + '">'
    + esc(issueNames[item.code] || item.code) + '</span> <span class="issue-path">' + esc(item.path)
    + '</span><p>' + esc(item.message) + '</p></article>');
  const notes = state.model.notes.map((note) => '<article class="issue"><span class="badge">模型备注</span><p>' + esc(note) + '</p></article>');
  pane.innerHTML = [...questions, ...issues, ...notes].join("")
    || '<p class="empty-text">当前检查没有发现导出阻塞项。</p>';
}

function renderSummary() {
  const { model, report, provenance } = state;
  $("geometry-subtitle").textContent = model?.title || "等待设计模型";
  const stage = $("stage");
  const ready = report?.ready && !state.reviewPending && !isDirty() && !jsonDirty();
  stage.className = "stage " + (report ? (ready ? "ready" : "draft") : "neutral");
  stage.textContent = report ? (ready ? "可导出" : "草稿") : "待提取";
  const names = { schema: "结构", analytic_geometry: "解析几何", evidence: "证据", geant4: "Geant4", dd4hep: "DD4hep" };
  const checks = { passed: "通过", failed: "有错误", needs_review: "待审", not_run: "未运行" };
  $("check-strip").innerHTML = Object.entries(names).map(([key, label]) => {
    const check = report?.checks?.[key] || "not_run";
    return '<span>' + label + ' <b class="' + esc(check) + '">' + esc(checks[check] || check) + "</b></span>";
  }).join("");
  $("check-strip").title = report?.scope || "";
  const materials = new Set(instances().map((item) => item.material));
  $("legend").innerHTML = [...materials].map((item) =>
    '<span><svg width="8" height="8" aria-hidden="true"><rect width="8" height="8" rx="2" fill="'
    + materialColor(item) + '"/></svg>' + esc(item) + "</span>").join("")
    || '<span class="muted">材料图例</span>';
  const metadata = $("provenance");
  metadata.hidden = !provenance;
  metadata.textContent = provenance ? [
    "提取记录", provenance.provider, provenance.model, provenance.response_model && "接口返回 " + provenance.response_model, provenance.prompt_version && "Prompt " + provenance.prompt_version,
    provenance.duration_s != null && number(provenance.duration_s) + " s",
    provenance.source_sha256 && "原始提取输入 SHA-256 " + provenance.source_sha256,
  ].filter(Boolean).join(" · ") : "";
}

function render() {
  renderSummary();
  renderTree();
  renderDetails();
  renderIssues();
  renderDrawing();
  scene.draw();
  updateControls();
}

function drawingSVG(plane, interactive = false) {
  const [a, b, h, v] = planes[plane];
  const list = instances();
  if (!list.length) return "";
  const model = state.model;
  const showWorld = $("world").checked || state.selection?.type === "world";
  const worldShape = { type: "box", size_mm: model.world.size_mm };
  const bounds = showWorld ? extent(worldShape).flatMap((n) => [-n, n]) : null;
  const dimensions = list.map((item) => extent(item.shape));
  const limits = (k) => [
    Math.min(bounds?.[k * 2] ?? Infinity, ...list.map((item, i) => item.global_mm[k] - dimensions[i][k])),
    Math.max(bounds?.[k * 2 + 1] ?? -Infinity, ...list.map((item, i) => item.global_mm[k] + dimensions[i][k])),
  ];
  const [left, right] = limits(a);
  const [bottom, top] = limits(b);
  const width = 760;
  const height = 390;
  const spanX = Math.max(right - left, 1e-9);
  const spanY = Math.max(top - bottom, 1e-9);
  const scale = Math.min((width - 160) / spanX, (height - 116) / spanY);
  const center = [(left + right) / 2, (bottom + top) / 2];
  const x = (n) => width / 2 + (n - center[0]) * scale;
  const y = (n) => height / 2 - (n - center[1]) * scale;
  const rectangle = (shape, centerMm, attrs) => {
    const e = extent(shape);
    return '<rect x="' + x(centerMm[a] - e[a]) + '" y="' + y(centerMm[b] + e[b])
      + '" width="' + (2 * e[a] * scale) + '" height="' + (2 * e[b] * scale) + '" ' + attrs + '/>';
  };
  const omitted = [0, 1, 2].find((axis) => axis !== a && axis !== b);
  const sorted = [...list].sort((p, q) => p.global_mm[omitted] - q.global_mm[omitted]);
  const order = Math.floor(Math.log10(Math.max(spanX, spanY) / 5));
  const unit = Math.pow(10, order);
  const step = [1, 2, 5, 10].map((n) => n * unit)
    .find((n) => n >= Math.max(spanX, spanY) / 7) || 10 * unit;
  const grid = [];
  const firstX = Math.ceil(left / step);
  for (let i = 0; i < 12 && firstX + i <= Math.floor(right / step); i++) {
    const n = firstX + i;
    const xx = x(n * step);
    grid.push('<path d="M' + xx + ' 32V342" stroke="' + (n === 0 ? "#4a627e" : "#21344e")
      + '"/><text x="' + xx + '" y="359" text-anchor="middle">' + number(n * step) + '</text>');
  }
  const firstY = Math.ceil(bottom / step);
  for (let i = 0; i < 12 && firstY + i <= Math.floor(top / step); i++) {
    const n = firstY + i;
    const yy = y(n * step);
    grid.push('<path d="M58 ' + yy + 'H712" stroke="' + (n === 0 ? "#4a627e" : "#21344e")
      + '"/><text x="50" y="' + (yy + 4) + '" text-anchor="end">' + number(n * step) + '</text>');
  }
  const shapes = sorted.map((item) => {
    const selected = isSelected(item);
    const color = materialColor(item.material);
    const attrs = 'fill="' + color + '" fill-opacity="' + (selected ? ".55" : ".29")
      + '" stroke="' + (selected ? "#b7fff2" : color) + '" stroke-width="' + (selected ? "2.1" : "1.25") + '"';
    let content;
    if (item.shape.type === "tube" && plane === "xy") {
      const [cx, cy] = [x(item.global_mm[a]), y(item.global_mm[b])];
      const outer = item.shape.rmax_mm * scale;
      const inner = item.shape.rmin_mm * scale;
      const circle = (r) => "M" + (cx - r) + " " + cy + "a" + r + " " + r + " 0 1 0 "
        + (2 * r) + " 0a" + r + " " + r + " 0 1 0 " + (-2 * r) + " 0Z";
      content = '<path d="' + circle(outer) + (inner ? circle(inner) : "") + '" fill-rule="evenodd" ' + attrs + '/>';
    } else {
      content = rectangle(item.shape, item.global_mm, attrs);
      if (item.shape.type === "tube" && item.shape.rmin_mm > 0) {
        const [topY, bottomY] = [y(item.global_mm[b] + item.shape.length_mm / 2), y(item.global_mm[b] - item.shape.length_mm / 2)];
        for (const sign of [-1, 1]) {
          const xx = x(item.global_mm[a] + sign * item.shape.rmin_mm);
          content += '<path d="M' + xx + ' ' + topY + 'V' + bottomY
            + '" stroke="' + color + '" stroke-opacity=".8" stroke-dasharray="4 3"/>';
        }
      }
    }
    const size = extent(item.shape).map((n) => 2 * n);
    const hint = item.id + " · " + number(size[a]) + " × " + number(size[b]) + " mm";
    return '<g' + (interactive ? ' tabindex="0" role="button" aria-label="' + esc(hint)
      + '" data-instance="' + esc(item.id) + '"' : "") + '><title>' + esc(hint) + '</title>' + content + '</g>';
  });
  const measured = sorted.find((item) => isSelected(item));
  let markers = "";
  if (measured) {
    const e = extent(measured.shape);
    const [x1, x2] = [x(measured.global_mm[a] - e[a]), x(measured.global_mm[a] + e[a])];
    const [y1, y2] = [y(measured.global_mm[b] + e[b]), y(measured.global_mm[b] - e[b])];
    const yy = y2 + 19;
    const xx = x2 + 19;
    markers = '<g stroke="#86f5de" stroke-width="1" fill="none" pointer-events="none">'
      + '<path d="M' + x1 + ' ' + (y2 + 4) + 'V' + (yy + 4) + 'M' + x2 + ' ' + (y2 + 4) + 'V' + (yy + 4)
      + 'M' + x1 + ' ' + yy + 'H' + x2 + 'M' + (x2 + 4) + ' ' + y1 + 'H' + (xx + 4) + 'M' + (x2 + 4) + ' ' + y2
      + 'H' + (xx + 4) + 'M' + xx + ' ' + y1 + 'V' + y2 + '"/></g>'
      + '<g fill="#9df5e5" font-size="11" pointer-events="none"><text x="' + ((x1 + x2) / 2)
      + '" y="' + (yy + 13) + '" text-anchor="middle">' + number(e[a] * 2) + ' mm</text><text x="' + (xx + 5)
      + '" y="' + ((y1 + y2) / 2 - 3) + '">' + number(e[b] * 2) + ' mm</text></g>';
  }
  const world = showWorld ? rectangle(worldShape, [0, 0, 0],
    'fill="none" stroke="#738da9" stroke-dasharray="6 5" stroke-width="1.2"') : "";
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height
    + '" role="' + (interactive ? "group" : "img") + '" aria-label="' + h + v
    + ' 几何投影，单位毫米"><title>' + esc(model.title) + ' / ' + h + v
    + '</title><rect width="100%" height="100%" fill="#0a1526"/><g font-family="monospace" font-size="10" fill="#9aafca">'
    + grid.join("") + '<text x="714" y="359">' + h + ' [mm]</text><text x="25" y="27">' + v
    + ' [mm]</text>' + world + shapes.join("") + markers + "</g></svg>";
}

function renderDrawing() {
  const view = state.view;
  const in3D = view === "3d";
  const hasInstances = instances().length > 0;
  $("scene").hidden = !in3D;
  $("drawing").hidden = in3D;
  $("view-empty").hidden = hasInstances;
  $("view-empty").querySelector("p").textContent = state.model
    ? "没有可预览的放置，请查看验证结果。" : "加载示例或提取草稿，开始查看几何";
  $("view-mode").textContent = in3D ? "3D / ORTHOGRAPHIC" : view.toUpperCase() + " / PROJECTION";
  $("view-help").textContent = in3D ? "拖动旋转 · 滚动缩放" : "选中对象 · 查看尺寸";
  $("drawing").innerHTML = in3D ? "" : drawingSVG(view, true);
  $("svg-export").title = "下载 " + (in3D ? "XZ" : view.toUpperCase()) + " 投影";
  for (const button of document.querySelectorAll("[data-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
}

function installScene(canvas, data, onSelect = () => {}) {
  const ctx = canvas.getContext("2d");
  let yaw = -.65;
  let pitch = .53;
  let zoom = 1;
  let hits = [];
  let drag;
  let scheduled = false;
  let geometryKey;
  let faces = [];
  const steps = [0, 1, 2];
  const boxEdges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const boxSides = [
    [[0, 1, 2, 3], [0, 0, -1]], [[4, 5, 6, 7], [0, 0, 1]],
    [[0, 1, 5, 4], [0, -1, 0]], [[3, 2, 6, 7], [0, 1, 0]],
    [[0, 3, 7, 4], [-1, 0, 0]], [[1, 2, 6, 5], [1, 0, 0]],
  ];
  function boxVertices(point, shape) {
    const [a, b, c] = shape.size_mm.map((n) => n / 2);
    return [[-a, -b, -c], [a, -b, -c], [a, b, -c], [-a, b, -c],
      [-a, -b, c], [a, -b, c], [a, b, c], [-a, b, c]].map((p) => p.map((v, i) => point[i] + v));
  }
  function mesh(items) {
    const subdivisions = items.length > 250 ? 14 : items.length > 75 ? 24 : 40;
    return items.flatMap((item) => {
      const shape = item.shape;
      const point = item.global_mm;
      const face = (p, normal, edge = true) => ({ p, normal, edge, item });
      if (shape.type === "box") {
        const vertices = boxVertices(point, shape);
        return boxSides.map(([indices, normal]) => face(indices.map((i) => vertices[i]), normal));
      }
      const radius = shape.rmax_mm;
      const inner = shape.rmin_mm;
      const half = shape.length_mm / 2;
      const ring = (r, z) => Array.from({ length: subdivisions }, (_, i) => {
        const a = i * Math.PI * 2 / subdivisions;
        return [point[0] + r * Math.cos(a), point[1] + r * Math.sin(a), point[2] + z];
      });
      const upper = ring(radius, half);
      const lower = ring(radius, -half);
      const innerUpper = inner ? ring(inner, half) : [];
      const innerLower = inner ? ring(inner, -half) : [];
      const result = inner ? [] : [face(upper, [0, 0, 1]), face(lower, [0, 0, -1])];
      for (let i = 0; i < subdivisions; i++) {
        const j = (i + 1) % subdivisions;
        const angle = (i + .5) * Math.PI * 2 / subdivisions;
        const normal = [Math.cos(angle), Math.sin(angle), 0];
        result.push(face([lower[i], lower[j], upper[j], upper[i]], normal, false));
        if (inner) {
          result.push(
            face([innerLower[i], innerLower[j], innerUpper[j], innerUpper[i]], normal.map((n) => -n), false),
            face([upper[i], upper[j], innerUpper[j], innerUpper[i]], [0, 0, 1], false),
            face([lower[i], lower[j], innerLower[j], innerLower[i]], [0, 0, -1], false),
          );
        }
      }
      return result;
    });
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const rgba = (hex, alpha, light = 1) => {
    const rgb = [1, 3, 5].map((start) => Math.round(Math.min(255, parseInt(hex.slice(start, start + 2), 16) * light)));
    return "rgba(" + rgb.join(",") + "," + alpha + ")";
  };
  function strokeLine(a, b) {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  function draw() {
    if (!ctx || !canvas.clientWidth || !canvas.clientHeight) return;
    const { items, world, showWorld, selected, colors: palette } = data();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const buffer = [Math.round(width * pixelRatio), Math.round(height * pixelRatio)];
    if (canvas.width !== buffer[0] || canvas.height !== buffer[1]) [canvas.width, canvas.height] = buffer;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.fillStyle = "#0a1526";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#15273e";
    ctx.lineWidth = 1;
    for (let x = width % 25; x < width; x += 25) strokeLine([x + .5, 0], [x + .5, height]);
    for (let y = height % 25; y < height; y += 25) strokeLine([0, y + .5], [width, y + .5]);
    hits = [];
    if (!items.length) return;

    if (items !== geometryKey) {
      faces = mesh(items);
      geometryKey = items;
    }
    const lo = showWorld && world ? world.size_mm.map((n) => -n / 2) : [Infinity, Infinity, Infinity];
    const hi = showWorld && world ? world.size_mm.map((n) => n / 2) : [-Infinity, -Infinity, -Infinity];
    for (const item of items) {
      const s = item.shape;
      const half = s.type === "box" ? s.size_mm.map((n) => n / 2) : [s.rmax_mm, s.rmax_mm, s.length_mm / 2];
      for (const k of steps) {
        lo[k] = Math.min(lo[k], item.global_mm[k] - half[k]);
        hi[k] = Math.max(hi[k], item.global_mm[k] + half[k]);
      }
    }
    const center = steps.map((k) => (lo[k] + hi[k]) / 2);
    const radius = Math.max(1e-12, Math.hypot(...steps.map((k) => (hi[k] - lo[k]) / 2)));
    const scale = Math.min(width, height) * .43 / radius * zoom;
    const [c, s, u, v] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
    const right = [c, -s, 0];
    const up = [-s * v, -c * v, u];
    const near = [s * u, c * u, v];
    const screen = (p) => {
      const q = p.map((n, i) => n - center[i]);
      return [width / 2 + dot(q, right) * scale, height / 2 - dot(q, up) * scale, dot(q, near)];
    };
    if (showWorld && world) {
      const p = boxVertices([0, 0, 0], { size_mm: world.size_mm }).map(screen);
      ctx.strokeStyle = "#7899ba";
      ctx.setLineDash([5, 5]);
      for (const [a, b] of boxEdges) strokeLine(p[a], p[b]);
      ctx.setLineDash([]);
    }
    const visible = [];
    for (const face of faces) {
      if (dot(face.normal, near) <= 1e-8) continue;
      const p = face.p.map(screen);
      const depth = p.reduce((total, point) => total + point[2], 0) / p.length;
      visible.push({ ...face, p, depth });
    }
    visible.sort((a, b) => a.depth - b.depth);
    const light = [-.3, .47, .83];
    for (const face of visible) {
      const { p, item } = face;
      const active = selected(item);
      const color = palette[item.material] || "#9baec7";
      const shade = .62 + .32 * dot(face.normal, light) + (active ? .19 : 0);
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      for (const point of p.slice(1)) ctx.lineTo(point[0], point[1]);
      ctx.closePath();
      ctx.fillStyle = rgba(color, 1, shade);
      ctx.fill();
      ctx.strokeStyle = face.edge ? rgba(active ? "#c8fff3" : color, active ? .85 : .72) : ctx.fillStyle;
      ctx.lineWidth = face.edge && active ? 1.3 : .6;
      ctx.stroke();
      hits.push({ id: item.id, p });
    }
    ctx.font = "11px monospace";
    for (const [axis, color, index] of [["X", "#e997a2", 0], ["Y", "#71d9be", 1], ["Z", "#91bcfa", 2]]) {
      const origin = [42, height - 39];
      const end = [origin[0] + 23 * right[index], origin[1] - 23 * up[index]];
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.25;
      strokeLine(origin, end);
      ctx.fillText(axis, end[0] + 3, end[1] + 4);
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      draw();
    });
  }
  function reset() {
    yaw = -.65;
    pitch = .53;
    zoom = 1;
    schedule();
  }
  function inside([x, y], polygon) {
    let isInside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [a, b] = polygon[i];
      const [c, d] = polygon[j];
      if ((b > y) !== (d > y) && x < a + (y - b) * (c - a) / (d - b)) isInside = !isInside;
    }
    return isInside;
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw, pitch };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    yaw = drag.yaw + (event.clientX - drag.x) * .012;
    pitch = Math.max(-1.54, Math.min(1.54, drag.pitch + (event.clientY - drag.y) * .012));
    schedule();
  });
  canvas.addEventListener("pointerup", (event) => {
    if (drag?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) {
      const rect = canvas.getBoundingClientRect();
      const point = [event.clientX - rect.left, event.clientY - rect.top];
      for (let i = hits.length - 1; i >= 0; i--) {
        if (inside(point, hits[i].p)) {
          onSelect(hits[i].id);
          break;
        }
      }
    }
    drag = null;
  });
  canvas.addEventListener("pointercancel", () => { drag = null; });
  canvas.addEventListener("lostpointercapture", () => { drag = null; });
  const zoomBy = (factor) => { zoom = Math.max(.18, Math.min(9, zoom * factor)); };
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
    zoomBy(Math.exp(-Math.max(-350, Math.min(350, delta)) * .0013));
    schedule();
  }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowLeft": yaw -= .13; break;
      case "ArrowRight": yaw += .13; break;
      case "ArrowUp": pitch = Math.min(1.54, pitch + .12); break;
      case "ArrowDown": pitch = Math.max(-1.54, pitch - .12); break;
      case "+":
      case "=": zoomBy(1.15); break;
      case "-": zoomBy(1 / 1.15); break;
      case "Home": reset(); break;
      default: return;
    }
    event.preventDefault();
    schedule();
  });
  new ResizeObserver(schedule).observe(canvas);
  schedule();
  return { draw: schedule, reset };
}

const scene = installScene($("scene"), () => ({
  items: instances(), world: state.model?.world,
  showWorld: $("world").checked || state.selection?.type === "world",
  selected: isSelected, colors,
}), (id) => select("instance", id));

function download(content, type, filename) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportPreview() {
  const payload = JSON.stringify({
    items: instances(), world: state.model.world, colors, showWorld: $("world").checked,
  }).replace(/</g, "\\u003c");
  const title = esc(state.model.title);
  const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' · DetWeave</title>'
    + '<style>body{margin:0;background:#0a1526;color:#e5edf8;font:14px system-ui,sans-serif}'
    + 'main{height:100dvh;min-height:300px;display:grid;grid-template-rows:auto minmax(0,1fr) auto}'
    + 'header,footer{padding:12px 16px;background:#101b2d}h1{margin:0 0 7px;font-size:19px;overflow-wrap:anywhere}'
    + 'p{margin:6px 0;color:#b7c9e0}button{background:#1a3048;border:1px solid #496283;color:#fff;border-radius:6px;'
    + 'padding:5px 9px;margin-right:10px}canvas{width:100%;height:100%;cursor:grab;touch-action:none}'
    + 'canvas:focus-visible{outline:2px solid #5ce0ca;outline-offset:-2px}</style></head><body><main><header>'
    + '<h1>' + title + ' · 离线 3D</h1><p>几何可视化 · 毫米 · Geant4 / DD4hep 运行验证未执行</p>'
    + '<button type="button" id="reset">复位视角</button><label><input id="world" type="checkbox"> World</label>'
    + '</header><canvas id="scene" tabindex="0" aria-label="探测器三维预览，方向键旋转，加减键缩放"></canvas>'
    + '<footer><span id="selection">拖动或方向键旋转 · 滚轮或加减键缩放 · 点击选中对象</span></footer></main><script>'
    + '"use strict";const payload=' + payload + ';const canvas=document.getElementById("scene");'
    + 'const world=document.getElementById("world");world.checked=payload.showWorld;let selection=null;'
    + 'const scene=(' + installScene.toString() + ')(canvas,()=>({...payload,showWorld:world.checked,'
    + 'selected:item=>item.id===selection}),id=>{selection=id;const item=payload.items.find(p=>p.id===id);'
    + 'document.getElementById("selection").textContent=item.id+" · "+item.material+" · ("+item.global_mm.join(", ")+") mm";scene.draw()});'
    + 'world.addEventListener("change",scene.draw);document.getElementById("reset").addEventListener("click",scene.reset);'
    + '</script></body></html>';
  download(html, "text/html;charset=utf-8", "detweave-3d.html");
}

function projectDocument() {
  return {
    format: saveKey, text: sourceInput.value, model: state.model, provenance: state.provenance,
    review_pending: state.reviewPending,
  };
}

async function openProject(documentValue, saveUndo = true) {
  if (!documentValue || typeof documentValue !== "object" || Array.isArray(documentValue)) throw new Error("请选择 DetWeave 项目 JSON 或几何 IR。");
  const wrapped = documentValue.format === saveKey || Object.hasOwn(documentValue, "model");
  const model = (wrapped ? documentValue.model : documentValue) ?? null;
  if (model !== null && (typeof model !== "object" || Array.isArray(model))) throw new Error("项目的 IR 必须是 JSON 对象。");
  if (!model && !(wrapped && typeof documentValue.text === "string")) throw new Error("项目缺少 IR 和讨论原文。");
  const text = (wrapped && typeof documentValue.text === "string" ? documentValue.text : model?.source_text) ?? "";
  if (typeof text !== "string" || text.length > 100000) throw new Error("项目原文必须为不超过 100,000 字符的文本。");
  const report = model ? await validated(model) : null;
  commit({
    model, report, provenance: wrapped ? publicProvenance(documentValue.provenance) : null,
    reviewPending: wrapped && documentValue.review_pending === true, text,
  }, saveUndo);
}

function refreshLocalSave() {
  let stored = false;
  try { stored = localStorage.getItem(saveKey) !== null; } catch { /* Storage can be disabled. */ }
  $("forget-local").hidden = !stored;
  $("local-save-state").textContent = stored
    ? "本浏览器已保存一份项目。清空工作台后仍可单独删除该副本。"
    : "浏览器默认不保存讨论内容。项目 JSON 包含讨论原文。";
}

function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

function markChangedEvidence(model, previous) {
  if (!previous) return false;
  const before = fieldsFor(previous);
  let changed = false;
  for (const [path, field] of fieldsFor(model)) {
    const entry = model.evidence[path];
    if (entry && before.has(path) && !sameValue(before.get(path).value, field.value)
      && sameValue(previous.evidence[path], entry)) {
      model.evidence[path] = {
        status: "unresolved", quote: entry.quote, note: "参数已修改，需重新核对该依据。",
      };
      changed = true;
    }
  }
  return changed;
}

async function applyModelJSON() {
  let model;
  try { model = JSON.parse(jsonInput.value); } catch { throw new Error("JSON 无法解析，请检查括号、引号和逗号。"); }
  let report = await validated(model);
  if (state.reviewPending && sameValue(model, state.model)) throw new Error("请先根据已记录的答复修改 IR，或重新提取。");
  if (markChangedEvidence(model, state.model)) report = await validated(model);
  const text = isDirty() && model.source_text === state.model.source_text ? sourceInput.value : model.source_text;
  commit({ model, report, text, provenance: state.provenance });
  notify(report.ready ? "IR 已应用，当前检查通过。" : "IR 已应用，仍有待核查项。", "success");
}

function appendSource(original, addition) {
  const result = original + (original ? "\n\n" : "") + addition;
  if (result.length > 100000) throw new Error("追加后原文会超过 100,000 字符。请先精简原文。");
  return result;
}

async function confirmEvidence(path) {
  if (isDirty()) throw new Error("请先提取或应用已修改的原文。");
  const field = fieldsFor(state.model).get(path);
  if (!field) throw new Error("没有找到该参数。");
  const line = "用户确认 [" + path + "] = " + JSON.stringify(field.value);
  if (!window.confirm("确认采用以下几何参数，并将这条确认附到原文？\n\n" + line)) {
    notify("确认已取消。");
    return;
  }
  const model = clone(state.model);
  model.source_text = appendSource(model.source_text, line);
  model.evidence[path] = {
    status: "confirmed", quote: line, note: "用户在 DetWeave 参数面板确认了此值。",
  };
  const report = await validated(model);
  commit({ model, report, provenance: state.provenance, reviewPending: state.reviewPending });
  notify("已记录此参数的用户确认。", "success");
}

async function answerQuestion(index, action) {
  const question = state.model.questions[index];
  const answer = $("answer-" + index).value.trim();
  if (!answer) throw new Error("请填写该问题的答复。");
  if (action === "record" && isDirty()) throw new Error("请先处理已修改的原文。");
  const line = "补充答复 [" + question.id + "]\n问题：" + question.question + "\n答复：" + answer;
  const text = appendSource(sourceInput.value, line);
  if (action === "extract") {
    remember();
    sourceInput.value = text;
    await extractGeometry(text);
    history.splice(history.length - 1, 1);
    return;
  }
  if (!window.confirm("记录此答复并移出待澄清项？后续需要应用 IR 修改或重新提取。")) {
    notify("记录已取消。");
    return;
  }
  const model = clone(state.model);
  model.source_text = text;
  model.questions.splice(index, 1);
  const fields = fieldsFor(model);
  for (const target of question.targets) {
    if (fields.has(target)) model.evidence[target] = {
      status: "unresolved", quote: "", note: "已补充答复，请将答复应用到此参数并复核。",
    };
  }
  const report = await validated(model);
  commit({ model, report, provenance: state.provenance, reviewPending: true });
  notify("已记录答复。请应用 IR 修改或重新提取。", "success");
}

async function loadExample(example, saveUndo = true) {
  const model = example.model;
  const report = await validated(model);
  commit({ model, report, text: example.text || model.source_text }, saveUndo);
  notify("已加载内置合成示例。", "success");
}

async function initialize() {
  setProvider();
  refreshLocalSave();
  render();
  await run("正在加载内置示例…", async () => {
    let stored = null;
    try { stored = localStorage.getItem(saveKey); } catch { /* Storage can be disabled. */ }
    const data = await api("/api/examples");
    state.examples = Array.isArray(data) ? data : (data.examples || []);
    const menu = $("examples");
    for (const example of state.examples) menu.add(new Option(example.title, example.id));
    if (stored) {
      await openProject(JSON.parse(stored), false);
      notify("已恢复本浏览器保存的项目。", "success");
    } else if (state.examples[0]) {
      const first = state.examples[0];
      await loadExample(first, false);
      menu.value = first.id;
    } else {
      notify("输入讨论原文或导入项目以开始。");
    }
  });
}

$("provider").addEventListener("change", setProvider);
sourceInput.addEventListener("input", () => { renderSummary(); updateControls(); });
jsonInput.addEventListener("input", () => { renderSummary(); updateControls(); });
$("extract").addEventListener("click", () => run("正在提取几何草稿…", () => extractGeometry(sourceInput.value)));
$("examples").addEventListener("change", () => {
  const example = state.examples.find((item) => item.id === $("examples").value);
  if (example) run("正在加载示例…", () => loadExample(example));
});
$("tree").addEventListener("click", (event) => {
  const item = event.target.closest("[data-type]");
  if (!item) return;
  const { type, id } = item.dataset;
  select(type, id);
  $("tree").querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
});
$("details").addEventListener("click", (event) => {
  const button = event.target.closest("[data-confirm]");
  if (button) run("正在记录确认…", () => confirmEvidence(button.dataset.confirm));
});
$("issues").addEventListener("click", (event) => {
  const button = event.target.closest("[data-question-action]");
  if (button) run("正在处理答复…", () => answerQuestion(Number(button.dataset.index), button.dataset.questionAction));
});
$("drawing").addEventListener("click", (event) => {
  const element = event.target.closest("[data-instance]");
  if (element) select("instance", element.dataset.instance);
});
$("drawing").addEventListener("keydown", (event) => {
  const element = event.target.closest("[data-instance]");
  if (element && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    select("instance", element.dataset.instance);
    $("drawing").querySelector('[data-instance="' + CSS.escape(element.dataset.instance) + '"]')?.focus();
  }
});
for (const button of document.querySelectorAll("[data-view]")) {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    renderDrawing();
    scene.draw();
    updateControls();
  });
}
$("world").addEventListener("change", () => { renderDrawing(); scene.draw(); });
$("reset-view").addEventListener("click", scene.reset);
$("svg-export").addEventListener("click", () => {
  const plane = state.view === "3d" ? "xz" : state.view;
  download(drawingSVG(plane), "image/svg+xml;charset=utf-8", "detweave-" + plane + ".svg");
});
$("html-export").addEventListener("click", exportPreview);
$("validate").addEventListener("click", () => run("正在验证模型…", async () => {
  state.report = await validated(state.model);
  render();
  notify(state.report.ready ? "当前模型检查通过。" : "验证完成。请查看待核查项。", "success");
}));
$("apply-json").addEventListener("click", () => run("正在验证修改后的 IR…", async () => {
  $("json-error").textContent = "";
  try { await applyModelJSON(); } catch (error) {
    $("json-error").textContent = error.message;
    throw error;
  }
}));
$("reset-json").addEventListener("click", () => {
  jsonInput.value = state.jsonCommitted;
  $("json-error").textContent = "";
  renderSummary();
  updateControls();
});
$("undo").addEventListener("click", () => {
  const previous = history.pop();
  if (!previous) return;
  commit(previous, false);
  $("examples").value = "";
  notify("已撤销上一步。", "success");
});
$("clear").addEventListener("click", () => {
  commit({ model: null, report: null });
  $("examples").value = "";
  $("api-key").value = "";
  notify("工作台已清空。可撤销此操作。");
});
$("save-local").addEventListener("click", () => run("正在保存项目…", async () => {
  try { localStorage.setItem(saveKey, JSON.stringify(projectDocument())); } catch {
    throw new Error("无法在本浏览器保存项目，可以下载项目 JSON。");
  }
  refreshLocalSave();
  notify("已保存到本浏览器。", "success");
}));
$("forget-local").addEventListener("click", () => run("正在删除浏览器副本…", async () => {
  localStorage.removeItem(saveKey);
  refreshLocalSave();
  notify("已删除浏览器副本。", "success");
}));
$("project-download").addEventListener("click", () =>
  download(JSON.stringify(projectDocument(), null, 2), "application/json", "detweave-project.json"));
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  run("正在导入项目…", async () => {
    if (file.size > 8_000_000) throw new Error("项目 JSON 超过 8 MB。");
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error("无法读取项目 JSON。"); }
    await openProject(parsed);
    $("examples").value = "";
    notify("已导入并重新校验项目。", "success");
  });
});
$("export").addEventListener("click", () => run("正在生成几何包…", async () => {
  const blob = await api("/api/export", { model: state.model, provenance: publicProvenance(state.provenance) }, true);
  download(blob, "application/zip", "detweave-geometry.zip");
  notify("几何包已下载。", "success");
}));

initialize();
