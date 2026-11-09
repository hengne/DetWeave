"use strict";

const $ = (id) => document.getElementById(id);
const t = (message) => window.DetWeaveI18n?.translate(message) ?? message;
const locale = () => window.DetWeaveI18n?.language || "zh-CN";
const countText = (count, singular, plural = singular) => count.toLocaleString(locale()) + " " + t(count === 1 || locale() !== "en" ? singular : plural);
const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const sourceInput = $("source-text");
const jsonInput = $("model-json");
const saveKey = "detweave.project.v1";
const lastProjectLocationKey = "detweave.projectLocation";
const providerCatalog = window.DETWEAVE_PROVIDERS || [];
const protocolLabels = {
  openai: "OpenAI / 兼容接口",
  anthropic: "Anthropic / 兼容接口",
  gemini: "Google Gemini",
};
const localized = (value) => value?.[locale() === "en" ? "en" : "zh"] || value?.en || "";
const currentPreset = () => providerCatalog.find((preset) => preset.id === $("provider").value);
const state = {
  model: null, report: null, provenance: null, reviewPending: false,
  view: "3d", selection: null, busy: false, examples: [], jsonCommitted: "",
  project: null, projects: [], projectLocations: null,
};
// Provider preferences live in the local backend, never in project/browser exports.
const providerPreferences = {profiles:{}, generation:0, queue:Promise.resolve(), timer:null, active:'demo', touched:new Set()};
function providerSaveStatus(message) {
  const node=$("provider-save-status");
  node.dataset.message=message;node.textContent=t(message);
}
async function providerSettingsRequest(body) {
  const response=await fetch('/api/settings/providers',{method:body===undefined?'GET':'POST',cache:'no-store',
    headers:{'Content-Type':'application/json','X-DetWeave':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)throw await responseError(response);
  return response.json();
}
function currentProviderProfile(id=providerPreferences.active) {
  return {id,base_url:$("base-url").value.trim(),model:$("model-name").value.trim(),api_key:$("api-key").value,
    thinking:$("ark-thinking").value,total_timeout_s:Number($("total-timeout").value)||600};
}
function queueProviderSave(body) {
  const generation=providerPreferences.generation;
  providerSaveStatus('正在保存模型配置…');
  providerPreferences.queue=providerPreferences.queue.catch(()=>{}).then(()=>providerSettingsRequest(body)).then(()=>{
    if(generation===providerPreferences.generation)providerSaveStatus('模型配置已自动保存到本机。');
  }).catch(()=>{
    if(generation===providerPreferences.generation)providerSaveStatus('模型配置保存失败；当前页面仍可使用，请检查本机配置目录权限。');
  });
}
function flushProviderSave() {
  clearTimeout(providerPreferences.timer);providerPreferences.timer=null;
  const active=$("provider").value;
  const body={active};
  if(active!=='demo') {
    const profile=currentProviderProfile(active);
    if(!Number.isInteger(profile.total_timeout_s)||profile.total_timeout_s<60||profile.total_timeout_s>900){
      providerSaveStatus('请填写 60–900 秒的整数时限后自动保存。');return;
    }
    providerPreferences.profiles[active]=profile;body.profile=profile;
  }
  queueProviderSave(body);
}
function scheduleProviderSave() {
  providerPreferences.touched.add($("provider").value);
  providerPreferences.generation++;
  clearTimeout(providerPreferences.timer);
  providerSaveStatus('正在保存模型配置…');
  providerPreferences.timer=setTimeout(flushProviderSave,300);
}
function applyProviderProfile(id) {
  const profile=providerPreferences.profiles[id];
  setProvider(true);
  $("total-timeout").value='600';
  if(!profile)return;
  $("base-url").value=profile.base_url||'';$("model-name").value=profile.model||'';
  $("api-key").value=profile.api_key||'';$("ark-thinking").value=profile.thinking||'';
  $("total-timeout").value=profile.total_timeout_s||600;
  renderProviderModels(currentPreset(),profile.model);
  setProvider(false);
}
async function restoreProviderPreferences() {
  try {
    const saved=await providerSettingsRequest();
    providerPreferences.profiles={...Object.fromEntries(Object.entries(saved.profiles||{}).filter(([id])=>!providerPreferences.touched.has(id))),...providerPreferences.profiles};
    if(providerPreferences.generation===0) {
      const active=[...$("provider").options].some(o=>o.value===saved.active)?saved.active:'demo';
      $("provider").value=active;providerPreferences.active=active;applyProviderProfile(active);
      providerSaveStatus('已恢复本机保存的模型配置。');
    }
  } catch {providerSaveStatus('无法读取已保存的模型配置；可重新配置，保存失败时会提示。');}
  finally {window.detweaveProviderSettingsReady=true;}
}
function changeProviderPreference() {
  // Persist pending edits before setProvider clears the outgoing fields.
  const pending=Boolean(providerPreferences.timer);
  clearTimeout(providerPreferences.timer);providerPreferences.timer=null;
  const previous=providerPreferences.active;
  if(previous!=='demo' && pending) {
    const profile=currentProviderProfile(previous);
    if(Number.isInteger(profile.total_timeout_s) && profile.total_timeout_s>=60 && profile.total_timeout_s<=900) {
      providerPreferences.profiles[previous]=profile;
      queueProviderSave({active:previous,profile});
    }
  }
  providerPreferences.active=$("provider").value;
  applyProviderProfile(providerPreferences.active);
  providerPreferences.generation++;flushProviderSave();
}


const history = [];
let activeExtraction = null;
const streamTextLimit = 200_000;
const streamLineLimit = 12_000_000;
const runStages = {
  connecting_local: "连接本地服务", browser_runtime: "准备浏览器运行环境",
  starting: "请求已接收", received: "请求已接收", queued: "排队等待",
  preparing: "准备提取", connecting: "连接服务商", connecting_provider: "连接服务商",
  waiting_provider: "等待服务商数据", provider_event: "收到服务商数据",
  buffered_response: "等待整段响应", parsing: "解析几何 JSON",
  reasoning: "收到思考片段", output: "接收几何 JSON", retrying: "服务端重试",
  validating: "校验提取结果", done: "已完成", failed: "失败", cancelled: "已取消",
};
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
  status.dataset.message = message;
  status.textContent = t(message);
  if (tone === "error" && $("chat-status")) $("chat-status").textContent = t(message);
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
    throw new Error(projectLocationMode() === "browser"
      ? "浏览器内嵌运行环境不可用。请重新打开单文件 DetWeave。"
      : "无法连接本地服务，请检查 DetWeave 是否仍在运行。");
  }
  if (response.ok) return binary ? response.blob() : response.json();
  throw await responseError(response);
}

async function responseError(response) {
  const result = await response.json().catch(() => null);
  const message = result?.error?.message || result?.error || result?.message || result?.detail;
  const fallback = projectLocationMode() === "browser" ? "浏览器运行环境返回 HTTP " : "本地服务返回 HTTP ";
  return new Error(typeof message === "string" ? message : fallback + response.status);
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
  for (const id of ["import", "provider", "base-url", "model-name", "ark-model-select", "api-key", "ark-thinking", "total-timeout",
    "project-menu", "project-title-input", "project-save", "project-refresh", "project-create-cancel",
    "project-create-location", "project-location-browse", "project-location-path-input", "project-location-register-button"]) {
    $(id).disabled = state.busy;
  }
  $("project-create-submit").disabled = state.busy || !selectedProjectLocation();
  if (typeof updateChatControls === "function") updateChatControls();
  sourceInput.readOnly = state.busy;
  jsonInput.readOnly = state.busy;
  $("dirty-label").textContent = dirty ? t("有尚未应用的原文修改") : "";
  $("text-length").textContent = countText(sourceInput.value.length, "字符");
  const reason = dirty ? "原文已有修改，请提取或同步更新 IR。"
    : jsonDirty() ? "IR 编辑框有未应用的修改。请应用或还原。"
    : state.reviewPending ? "已记录答复，请修改 IR 并验证，或重新提取。"
      : state.report?.ready ? "可导出当前模型。Geant4 与 DD4hep 运行检查未执行。"
        : "几何通过结构、解析几何及证据检查后可导出。";
  $("export-help").textContent = t(reason);
  $("export").title = t(reason);
  for (const button of document.querySelectorAll("[data-confirm], [data-question-action], [data-project-prompt], [data-project-run]")) {
    button.disabled = state.busy || (dirty && (button.dataset.confirm || button.dataset.questionAction === "record"));
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
  delete $("json-error").dataset.message;
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

function renderProviderMenu() {
  const menu = $("provider");
  const previous = menu.value || "demo";
  menu.replaceChildren(new Option(t("离线演示 · 固定示例"), "demo"));
  for (const preset of providerCatalog) menu.add(new Option(localized(preset.label), preset.id));
  for (const [kind, label] of Object.entries(protocolLabels)) menu.add(new Option(t(label), kind));
  menu.value = [...menu.options].some((option) => option.value === previous) ? previous : "demo";
}

function renderProviderModels(preset, selected) {
  const menu = $("ark-model-select");
  menu.replaceChildren();
  if (!preset) return;
  const groups = new Map();
  for (const model of preset.models || []) {
    const option = new Option(localized(model.label) || model.id, model.id);
    if (!model.group) menu.add(option);
    else {
      if (!groups.has(model.group)) {
        const group = document.createElement("optgroup");
        group.label = model.group;
        groups.set(model.group, group);
        menu.append(group);
      }
      groups.get(model.group).append(option);
    }
  }
  menu.add(new Option(t("手动输入模型 ID…"), "__custom__"));
  menu.value = [...menu.options].some((option) => option.value === selected) ? selected : "__custom__";
}

function setProvider(reset = false) {
  const preset = currentPreset();
  const live = $("provider").value !== "demo";
  const ark = preset?.thinking === "ark";
  const model = $("model-name");
  if (reset) {
    $("base-url").value = preset?.base_url || "";
    model.value = preset?.default_model || "";
    $("api-key").value = "";
    $("ark-thinking").value = "";
  }
  renderProviderModels(preset, reset ? preset?.default_model : $("ark-model-select").value || preset?.default_model);
  const customModel = !preset || $("ark-model-select").value === "__custom__";
  $("ark-model-fields").hidden = !preset;
  $("model-name-label").hidden = !customModel;
  model.hidden = !customModel;
  $("provider-fields").hidden = !live;
  $("ark-thinking-fields").hidden = !ark;
  const privacy = "提取时会将讨论发送到所选服务。模型配置自动保存到本机用户配置，不随项目导出。";
  $("provider-help").textContent = t(live ? privacy : "仅匹配内置合成示例，适合离线体验。");
  const help = $("ark-model-help");
  help.replaceChildren();
  if (preset) {
    help.textContent = localized(preset.summary);
    for (const source of preset.sources || []) {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = localized(source.label) + " ↗";
      help.append(" ", link);
    }
  }
  updateThinkingOptions();
}

function updateThinkingOptions() {
  const required = currentPreset()?.thinking === "ark"
    && ["glm-5.3", "glm-latest", "kimi-k3", "kimi-k3.1-pro"].includes($("model-name").value.trim().toLowerCase());
  $("ark-thinking").querySelector('[value="disabled"]').disabled = required;
  if (required && $("ark-thinking").value === "disabled") $("ark-thinking").value = "";
  $("ark-thinking-help").textContent = t(required
    ? "该模型默认开启思考，官方说明不支持关闭。已使用默认或开启模式。"
    : "显式开关需模型支持。接口拒绝时会显示错误。");
}

function selectPresetModel() {
  const selected = $("ark-model-select").value;
  const custom = selected === "__custom__";
  $("model-name").hidden = !custom;
  $("model-name-label").hidden = !custom;
  $("model-name").value = custom ? "" : selected;
  updateThinkingOptions();
  if (custom) $("model-name").focus();
}

function configuredProvider() {
  const choice = $("provider").value;
  if (choice === "demo") return { kind: choice };
  const preset = currentPreset();
  const provider = {
    kind: preset?.kind || choice,
    base_url: $("base-url").value.trim() || preset?.base_url || "",
    model: $("model-name").value.trim(),
    api_key: $("api-key").value,
    total_timeout_s: $("total-timeout").value === "" ? 600 : Number($("total-timeout").value),
  };
  const thinking = $("ark-thinking").value;
  if (preset?.thinking === "ark" && ["enabled", "disabled"].includes(thinking)) provider.thinking = thinking;
  return provider;
}

function publicProvenance(value) {
  if (!value || typeof value !== "object") return null;
  const result = {};
  for (const key of ["provider", "model", "response_model", "thinking", "prompt_version", "source_sha256"]) {
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
  if (provider.kind !== "demo" && (!Number.isInteger(provider.total_timeout_s)
    || provider.total_timeout_s < 60 || provider.total_timeout_s > 900)) {
    throw new Error("提取总时限需为 60–900 秒之间的整数。");
  }
  const operation = beginExtraction(provider.kind === "demo");
  try {
    const result = await streamExtraction(text, provider, operation);
    operation.controller.signal.throwIfAborted();
    if (!result?.model?.world || !Array.isArray(result.model.volumes)
      || !Array.isArray(result.model.placements) || !Array.isArray(result.model.questions)
      || !Array.isArray(result.model.notes) || !result.model.evidence
      || !result.report || !Array.isArray(result.report.issues)
      || !Array.isArray(result.report.instances)) {
      throw new Error("流式响应未包含完整的几何模型与验证结果。");
    }
    if (schemaFailed(result.report)) {
      throw new Error(result.report.issues[0]?.message || "提取结果的 IR 结构无效。");
    }
    commit({ model: result.model, report: result.report, provenance: publicProvenance(result.provenance) });
    const message = result.report.ready ? "已提取并通过当前导出检查。" : "已提取草稿。请核对待审项目。";
    finishExtraction(operation, "done", message);
    notify(message, "success");
    return true;
  } catch (error) {
    if (operation.controller.signal.aborted) {
      const message = "已取消当前提取请求，保留当前模型。";
      finishExtraction(operation, "cancelled", message);
      notify(message);
      return false;
    }
    finishExtraction(operation, "failed", error.message + " 保留当前模型。", error.code);
    throw error;
  } finally {
    if (operation.projectId) refreshProjectAfterRun(operation.projectId, operation.controller.signal.aborted);
  }
}

function toggleRunMonitor(open) {
  $("run-monitor").hidden = !open;
  $("run-toggle").setAttribute("aria-expanded", String(open));
}

function clearRunMonitor() {
  toggleRunMonitor(false);
  for (const channel of ["reasoning", "output"]) {
    $("run-" + channel).replaceChildren();
    $("run-" + channel + "-truncated").hidden = true;
  }
  $("run-log").replaceChildren();
  $("run-log-truncated").hidden = true;
  $("run-stage").dataset.label = "待运行";
  $("run-stage").textContent = t("待运行");
  $("run-stage").dataset.state = "idle";
  $("run-elapsed").textContent = "—";
  $("run-activity").textContent = "—";
  delete $("run-activity").dataset.label;
  setRunMessage("开始提取后会在这里显示进度。");
}

function durationLabel(seconds) {
  const rounded = Math.max(0, Math.floor(seconds));
  return String(Math.floor(rounded / 60)).padStart(2, "0") + ":" + String(rounded % 60).padStart(2, "0");
}

function updateRunClock(operation) {
  const now = operation.endedAt ?? performance.now();
  const elapsed = durationLabel((now - operation.startedAt) / 1000);
  const activity = operation.demo ? "离线演示"
    : operation.providerAt == null ? "尚未收到"
      : durationLabel((now - operation.providerAt) / 1000);
  if ($("run-elapsed").textContent !== elapsed) $("run-elapsed").textContent = elapsed;
  $("run-activity").dataset.label = activity;
  if ($("run-activity").textContent !== t(activity)) $("run-activity").textContent = t(activity);
}

function setRunStage(stage, tone = "active", message) {
  const label = $("run-stage");
  label.dataset.label = runStages[stage] || "运行中";
  label.textContent = t(label.dataset.label);
  label.dataset.state = tone;
  if (message) setRunMessage(message.slice(0, 1600));
}

function setRunMessage(message) {
  $("run-message").dataset.message = message;
  $("run-message").textContent = t(message);
}

function logRunEvent(operation, message, { tone = "", elapsed_s } = {}) {
  const log = $("run-log");
  const follow = log.scrollHeight - log.clientHeight - log.scrollTop < 24;
  const item = document.createElement("li");
  const stamp = document.createElement("time");
  stamp.textContent = durationLabel(Number.isFinite(elapsed_s) ? elapsed_s : (performance.now() - operation.startedAt) / 1000);
  item.className = tone;
  const content = document.createElement("span");
  content.dataset.message = message.slice(0, 1000);
  content.textContent = t(content.dataset.message);
  item.append(stamp, content);
  log.append(item);
  if (log.children.length > 100) {
    log.firstElementChild.remove();
    $("run-log-truncated").hidden = false;
  }
  if (follow) log.scrollTop = log.scrollHeight;
}

function beginExtraction(demo) {
  const operation = {
    controller: new AbortController(), startedAt: performance.now(), demo,
    providerAt: null, received: new Set(), buffers: {}, projectId: state.project?.id,
  };
  for (const channel of ["reasoning", "output"]) {
    const node = document.createTextNode("");
    $("run-" + channel).replaceChildren(node);
    $("run-" + channel + "-truncated").hidden = true;
    operation.buffers[channel] = node;
  }
  $("run-log").replaceChildren();
  $("run-log-truncated").hidden = true;
  $("run-cancel").disabled = false;
  const portable = projectLocationMode() === "browser";
  setRunStage(portable ? "browser_runtime" : "connecting_local", "active",
    portable ? "正在准备本次浏览器提取。" : "正在等待本地服务接收请求。");
  logRunEvent(operation, "发起提取请求。");
  activeExtraction = operation;
  updateRunClock(operation);
  operation.timer = setInterval(() => updateRunClock(operation), 250);
  toggleRunMonitor(true);
  $("run-close").focus({ preventScroll: true });
  return operation;
}

function finishExtraction(operation, stage, message, code) {
  operation.endedAt = performance.now();
  clearInterval(operation.timer);
  activeExtraction = null;
  $("run-cancel").disabled = true;
  setRunStage(stage, stage, message);
  logRunEvent(operation, (code ? "[" + code + "] " : "") + message, { tone: stage === "failed" ? "failure" : "" });
  updateRunClock(operation);
}

function appendRunText(operation, channel, text) {
  const node = operation.buffers[channel];
  const room = streamTextLimit - node.length;
  if (text.length > room) $("run-" + channel + "-truncated").hidden = false;
  if (!room) return;
  const pre = $("run-" + channel);
  const follow = pre.scrollHeight - pre.clientHeight - pre.scrollTop < 24;
  node.appendData(text.slice(0, room));
  if (follow) pre.scrollTop = pre.scrollHeight;
}

function handleRunEvent(operation, event) {
  const { type, elapsed_s } = event;
  const now = performance.now();
  if (!operation.demo && ["reasoning", "output", "usage", "activity"].includes(type)) {
    operation.providerAt = now;
  }
  if (type === "status") {
    const message = typeof event.message === "string" ? event.message : "";
    const stage = event.stage;
    if (stage === "provider_event" && !operation.demo) operation.providerAt = now;
    setRunStage(["done", "failed", "cancelled"].includes(stage) ? "validating" : stage, "active", message);
    if (message) logRunEvent(operation, message, { elapsed_s });
  } else if (type === "heartbeat") {
    const age = event.seconds_since_provider_event;
    if (!operation.demo && Number.isFinite(age) && age >= 0) operation.providerAt = now - age * 1000;
    if (operation.heartbeatLoggedAt == null || now - operation.heartbeatLoggedAt >= 10_000) {
      logRunEvent(operation, "本地心跳 · 等待下一条数据。", { tone: "heartbeat", elapsed_s });
      operation.heartbeatLoggedAt = now;
    }
  } else if ((type === "output" || (type === "reasoning" && !operation.demo)) && typeof event.text === "string" && event.text) {
    appendRunText(operation, type, event.text);
    if (!operation.received.has(type)) {
      const message = type === "reasoning" ? "收到服务商公开的思考片段。" : "收到首个几何 JSON 片段。";
      setRunStage(type, "active", message);
      logRunEvent(operation, message, { elapsed_s });
      operation.received.add(type);
    }
  } else if (type === "usage") {
    const model = typeof event.response_model === "string" && event.response_model;
    const usage = event.usage && Object.entries(event.usage)
      .filter(([, value]) => Number.isFinite(value))
      .map(([key, value]) => key + "=" + value).join(" · ");
    logRunEvent(operation, ["服务商响应信息", model, usage].filter(Boolean).join(" · "), { elapsed_s });
  }
  updateRunClock(operation);
}

function parseRunLine(line) {
  if (line.length > streamLineLimit) throw new Error("流式响应中的单条事件过大。");
  if (!line.trim()) return null;
  try {
    const event = JSON.parse(line);
    if (typeof event?.type === "string") return event;
  } catch { /* Invalid events are reported below. */ }
  throw new Error("本地服务返回了无效的流式事件。");
}

async function streamExtraction(text, provider, operation) {
  const { signal } = operation.controller;
  let response;
  try {
    response = await fetch("/api/extract/stream", {
      method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", "X-DetWeave": "1", Accept: "application/x-ndjson" },
      body: JSON.stringify({ text, provider, project_id: operation.projectId }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(projectLocationMode() === "browser"
      ? "浏览器内嵌提取环境不可用。请重新打开单文件 DetWeave。"
      : "无法连接本地流式服务，请检查 DetWeave 是否仍在运行。");
  }
  if (response.status === 404) throw new Error(projectLocationMode() === "browser"
    ? "此单文件版本缺少提取接口。请打开新版 DetWeave HTML。"
    : "本地服务没有流式提取接口。请重启新版 DetWeave。");
  if (!response.ok) throw await responseError(response);
  if (!response.body || !response.headers.get("Content-Type")?.toLowerCase().startsWith("application/x-ndjson")) {
    throw new Error("本地服务未返回 NDJSON 流式响应。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  try {
    while (true) {
      let part;
      try { part = await reader.read(); } catch (error) {
        if (signal.aborted) throw error;
        throw new Error("流式连接意外中断。");
      }
      signal.throwIfAborted();
      try {
        buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true });
      } catch {
        throw new Error("流式响应包含无效的 UTF-8 数据。");
      }
      const lines = buffer.split("\n");
      buffer = part.done ? "" : lines.pop();
      if (buffer.length > streamLineLimit) throw new Error("流式响应中的单条事件过大。");
      for (const line of lines) {
        const event = parseRunLine(line);
        if (!event) continue;
        if (event.type === "result") return event.result;
        if (event.type === "error") {
          const error = new Error(typeof event.message === "string" && event.message ? event.message.slice(0, 1600) : "服务端报告流式提取失败。");
          if (typeof event.code === "string") error.code = event.code.slice(0, 80);
          throw error;
        }
        handleRunEvent(operation, event);
      }
      if (part.done) throw new Error("流式连接已结束，未收到最终提取结果。");
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function nodeButton(type, id, meta, symbol, label = id) {
  const active = state.selection?.type === type && state.selection.id === id;
  return '<button type="button" data-type="' + esc(type) + '" data-id="' + esc(id)
    + '" aria-pressed="' + active + '"><span class="node-dot" aria-hidden="true">' + symbol
    + '</span><span class="mono">' + esc(label) + '</span><small>' + esc(t(meta)) + '</small></button>';
}

function renderTree() {
  const tree = $("tree");
  const model = state.model;
  $("counts").textContent = countText(instances().length, "实例", "实例数");
  if (!model) {
    tree.innerHTML = '<p class="empty-text">' + esc(t("当前没有几何模型。")) + '</p>';
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
    + (definitions ? '<p class="tree-divider">' + esc(t("体积定义")) + ' · ' + model.volumes.length + '</p><ul>' + definitions + "</ul>" : "");
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
      const quotes = entry ? (Array.isArray(entry.quote) ? entry.quote : [entry.quote]) : [];
      const hasQuote = quotes.some((quote) => quote.trim());
      const validQuote = quotes.length > 0 && quotes.every((quote) => quote.trim() && model.source_text.includes(quote));
      const acceptable = validQuote && ["stated", "confirmed"].includes(entry.status);
      const kind = entry?.status || "missing";
      return '<details class="evidence"' + (acceptable ? "" : " open") + '><summary>' + esc(t(field.label))
        + ' <span class="badge ' + esc(kind) + '">' + esc(t(statusNames[kind])) + "</span></summary>"
        + '<p class="issue-path">' + esc(path) + "</p>"
        + (hasQuote ? quotes.map((quote) => '<blockquote>' + esc(quote) + '</blockquote>').join("") : '<p class="muted">' + esc(t("暂无原文引句。")) + '</p>')
        + (entry?.note ? '<p class="muted">' + esc(entry.note) + '</p>' : "")
        + (hasQuote && !validQuote ? '<p class="error">' + esc(t("引句未出现在原文中。")) + '</p>' : "")
        + (acceptable ? "" : '<button type="button" class="text-button" data-confirm="' + esc(path) + '">' + esc(t("记录此值已确认")) + '</button>')
        + "</details>";
    }).join("");
}

function renderDetails() {
  const pane = $("details");
  const model = state.model;
  const selection = state.selection;
  if (!selectionExists(selection)) {
    $("selection-kind").textContent = "—";
    pane.innerHTML = '<p class="empty-text">' + esc(t("选中结构或投影中的对象，查看尺寸、材料和证据。")) + '</p>';
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
  $("selection-kind").textContent = t(kinds[selection.type]);
  pane.innerHTML = '<h4>' + esc(selection.id) + '</h4><dl class="param-list">'
    + values.map(([key, value]) => "<dt>" + esc(t(key)) + "</dt><dd>" + esc(value) + "</dd>").join("")
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
  $("issue-count").textContent = report ? countText(report.issues.length, "项") : "—";
  if (!report) {
    pane.innerHTML = '<p class="empty-text">' + esc(t("提取或导入模型后显示验证结果。")) + '</p>';
    return;
  }
  const questions = state.model.questions.map((question, index) =>
    '<article class="issue"><span class="badge blocker">' + esc(t("待澄清")) + '</span> <span class="issue-path">'
    + esc(question.id) + '</span><p>' + esc(question.question) + '</p>'
    + (question.targets.length ? '<p class="issue-path">' + esc(question.targets.join(" · ")) + '</p>' : "")
    + '<textarea id="answer-' + index + '" maxlength="2000" aria-label="' + esc(t("答复")) + ' ' + esc(question.id)
    + '" placeholder="' + esc(t("填写设计方的答复")) + '"></textarea><div class="issue-actions">'
    + '<button type="button" class="button compact" data-question-action="extract" data-index="' + index + '">' + esc(t(document.getElementById("chat-input") ? "在对话中答复" : "补充并提取")) + '</button>'
    + '<button type="button" class="button compact quiet" data-question-action="record" data-index="' + index
    + '" title="' + esc(t("记录答复并移出问题。仍需修改 IR 或重新提取。")) + '">' + esc(t("记录答复")) + '</button></div></article>');
  const issues = report.issues.filter((item) => item.code !== "clarification").map((item) =>
    '<article class="issue"><span class="badge ' + esc(item.level) + '">'
    + esc(t(issueNames[item.code] || item.code)) + '</span> <span class="issue-path">' + esc(item.path)
    + '</span><p>' + esc(item.message) + '</p></article>');
  const notes = state.model.notes.map((note) => '<article class="issue"><span class="badge">' + esc(t("模型备注")) + '</span><p>' + esc(note) + '</p></article>');
  pane.innerHTML = [...questions, ...issues, ...notes].join("")
    || '<p class="empty-text">' + esc(t("当前检查没有发现导出阻塞项。")) + '</p>';
}

function renderSummary() {
  const { model, report, provenance } = state;
  $("geometry-subtitle").textContent = model?.title || t("等待设计模型");
  const stage = $("stage");
  const ready = report?.ready && !state.reviewPending && !isDirty() && !jsonDirty();
  stage.className = "stage " + (report ? (ready ? "ready" : "draft") : "neutral");
  stage.textContent = t(report ? (ready ? "可导出" : "草稿") : "待提取");
  const names = { schema: "结构", analytic_geometry: "解析几何", evidence: "证据", geant4: "Geant4", dd4hep: "DD4hep" };
  const checks = { passed: "通过", failed: "有错误", needs_review: "待审", not_run: "未运行" };
  $("check-strip").innerHTML = Object.entries(names).map(([key, label]) => {
    const check = report?.checks?.[key] || "not_run";
    return '<span>' + esc(t(label)) + ' <b class="' + esc(check) + '">' + esc(t(checks[check] || check)) + "</b></span>";
  }).join("");
  $("check-strip").title = report?.scope || "";
  const materials = new Set(instances().map((item) => item.material));
  $("legend").innerHTML = [...materials].map((item) =>
    '<span><svg width="8" height="8" aria-hidden="true"><rect width="8" height="8" rx="2" fill="'
    + materialColor(item) + '"/></svg>' + esc(item) + "</span>").join("")
    || '<span class="muted">' + esc(t("材料图例")) + '</span>';
  const metadata = $("provenance");
  metadata.hidden = !provenance;
  metadata.textContent = provenance ? [
    t("提取记录"), provenance.provider, provenance.model, provenance.response_model && t("接口返回") + " " + provenance.response_model, provenance.prompt_version && "Prompt " + provenance.prompt_version,
    provenance.duration_s != null && number(provenance.duration_s) + " s",
    provenance.source_sha256 && t("原始提取输入 SHA-256") + " " + provenance.source_sha256,
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
    + ' ' + esc(t("几何投影，单位毫米")) + '"><title>' + esc(model.title) + ' / ' + h + v
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
    ? t("没有可预览的放置，请查看验证结果。") : t("加载示例或提取草稿，开始查看几何");
  $("view-mode").textContent = in3D ? "3D / ORTHOGRAPHIC" : view.toUpperCase() + " / PROJECTION";
  $("view-mode").dataset.view = view;
  $("view-help").textContent = t(in3D ? "拖动旋转 · 滚动缩放" : "选中对象 · 查看尺寸");
  $("drawing").innerHTML = in3D ? "" : drawingSVG(view, true);
  $("svg-export").title = t("下载") + " " + (in3D ? "XZ" : view.toUpperCase()) + " " + t("投影");
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
            face([upper[i], upper[j], innerUpper[j], innerUpper[i]], [0, 0, 1], true),
            face([lower[i], lower[j], innerLower[j], innerLower[i]], [0, 0, -1], true),
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

async function download(content, type, filename) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  if (typeof window.DetWeaveNativeSave === "function") {
    try {
      const result = await window.DetWeaveNativeSave(blob, filename);
      if (result === true || result?.saved) return true;
      if (result?.cancelled) {
        notify("已取消保存。");
        return false;
      }
      throw new Error("原生保存失败。");
    } catch {
      notify("原生保存失败。", "error");
      return false;
    }
  }
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function exportPreview() {
  const payload = JSON.stringify({
    items: instances(), world: state.model.world, colors, showWorld: $("world").checked,
  }).replace(/</g, "\\u003c");
  const title = esc(state.model.title);
  const html = '<!doctype html><html lang="' + locale() + '"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' · DetWeave</title>'
    + '<style>body{margin:0;background:#0a1526;color:#e5edf8;font:14px system-ui,sans-serif}'
    + 'main{height:100dvh;min-height:300px;display:grid;grid-template-rows:auto minmax(0,1fr) auto}'
    + 'header,footer{padding:12px 16px;background:#101b2d}h1{margin:0 0 7px;font-size:19px;overflow-wrap:anywhere}'
    + 'p{margin:6px 0;color:#b7c9e0}button{background:#1a3048;border:1px solid #496283;color:#fff;border-radius:6px;'
    + 'padding:5px 9px;margin-right:10px}canvas{width:100%;height:100%;cursor:grab;touch-action:none}'
    + 'canvas:focus-visible{outline:2px solid #5ce0ca;outline-offset:-2px}</style></head><body><main><header>'
    + '<h1>' + title + ' · ' + esc(t("离线 3D")) + '</h1><p>' + esc(t("几何可视化 · 毫米 · Geant4 / DD4hep 运行验证未执行")) + '</p>'
    + '<button type="button" id="reset">' + esc(t("复位视角")) + '</button><label><input id="world" type="checkbox"> World</label>'
    + '</header><canvas id="scene" tabindex="0" aria-label="' + esc(t("探测器三维预览，方向键旋转，加减键缩放")) + '"></canvas>'
    + '<footer><span id="selection">' + esc(t("拖动或方向键旋转 · 滚轮或加减键缩放 · 点击选中对象")) + '</span></footer></main><script>'
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

const projectURL = (id) => "/api/projects/" + encodeURIComponent(id);
const projectLocationsURL = "/api/projects/locations";

function projectLocationMode() {
  const configured = state.projectLocations?.mode || state.projectLocations?.capabilities?.mode
    || window.DetWeaveProjectStorageMode;
  if (configured && configured !== "desktop") return configured;
  const mobileWebView = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (mobileWebView && typeof window.DetWeaveNativeSave === "function") return "app-private";
  if (window.DetWeavePortable || window.location.protocol === "file:") return "browser";
  return "desktop";
}

function projectPathDisplay(value) {
  if (projectLocationMode() !== "browser") return value;
  const library = "浏览器项目库（请定期导出备份）";
  const other = "Browser project library (export backups regularly)";
  const prefix = value.startsWith(library) ? library : value.startsWith(other) ? other : "";
  return prefix ? t(library) + value.slice(prefix.length) : value;
}

function projectStorageMessage() {
  const mode = projectLocationMode();
  if (mode === "browser") return "创建项目后，讨论版本与提取记录将保存在所选浏览器存储位置。";
  if (mode === "app-private" || mode === "mobile") return "创建项目后，讨论版本与提取记录保存到应用的私有文档目录。";
  return "创建项目后，讨论版本与提取记录保存到本机目录。";
}

function selectedProjectLocation() {
  const id = $("project-create-location").value;
  return state.projectLocations?.locations.find((location) => location.id === id && location.available !== false);
}

function recentProjectLocation() {
  try {
    return localStorage.getItem(lastProjectLocationKey) || state.projectLocations?.recent_id;
  } catch {
    return state.projectLocations?.recent_id;
  }
}

function rememberProjectLocation(id) {
  try { localStorage.setItem(lastProjectLocationKey, id); } catch { /* Browser storage is optional. */ }
}

function renderProjectLocationMenu(selected = $("project-create-location").value) {
  const menu = $("project-create-location");
  const info = state.projectLocations;
  const recent = recentProjectLocation();
  const mode = projectLocationMode();
  menu.replaceChildren(new Option(t("选择创建位置…"), ""));
  const locations = [...(info?.locations || [])];
  const priority = (location) => location.id === recent ? 0 : location.id === info?.default_id ? 1 : 2;
  locations.sort((a, b) => priority(a) - priority(b));
  for (const location of locations) {
    const label = location.id === recent ? t("上次使用") : location.id === info?.default_id ? t("默认位置") : "";
    const value = projectPathDisplay(location.display_path || location.path || location.label || "");
    const option = new Option([label, value, location.available === false && t("不可用")].filter(Boolean).join(" · "), location.id);
    option.disabled = location.available === false;
    menu.add(option);
  }
  menu.value = locations.some((location) => location.id === selected && location.available !== false) ? selected : "";
  const capabilities = info?.capabilities || {};
  $("project-location-browse").hidden = typeof window.DetWeaveSelectProjectFolder !== "function"
    && !(mode === "desktop" && (info?.system_picker || capabilities.system_picker));
  $("project-location-register").hidden = !info
    || mode !== "desktop" || !(info.register_path ?? capabilities.register_path ?? true);
  $("project-create-location-help").textContent = t(mode === "app-private" || mode === "mobile"
    ? "项目保存在应用的私有文档目录。可以从项目中单独导出文件。"
    : mode === "browser" ? "项目保存在所选的浏览器存储位置。可另行导出项目文件。"
      : "将在所选父目录中创建项目子目录。创建后可查看实际路径。");
  showSelectedProjectLocation();
}

function showSelectedProjectLocation() {
  const location = selectedProjectLocation();
  const path = $("project-create-location-path");
  path.hidden = !location;
  path.textContent = location ? projectPathDisplay(location.display_path || location.path || location.label || "") : "";
  updateControls();
}

let projectLocationRequest = 0;
async function refreshProjectLocations() {
  const request = ++projectLocationRequest;
  const result = await api(projectLocationsURL);
  if (request !== projectLocationRequest) return;
  if (!Array.isArray(result.locations)) throw new Error("本地服务未返回项目位置。");
  const previousMessage = projectStorageMessage();
  state.projectLocations = result;
  renderProjectLocationMenu();
  if (state.project) renderProjectFolder();
  else if ($("project-message").dataset.message === previousMessage) setProjectMessage(projectStorageMessage());
}

function acceptProjectLocation(location) {
  if (!location || typeof location.id !== "string") throw new Error("本地服务未返回有效的文件夹。");
  projectLocationRequest++;
  if (!state.projectLocations) state.projectLocations = { locations: [] };
  const entries = state.projectLocations.locations;
  const index = entries.findIndex((item) => item.id === location.id);
  if (index >= 0) entries[index] = location;
  else entries.push(location);
  renderProjectLocationMenu(location.id);
}

function projectLocationAction(label, work) {
  return run(label, async () => {
    $("project-create-error").textContent = "";
    try { await work(); } catch (error) {
      $("project-create-error").textContent = t(error.message);
      throw error;
    }
  });
}

function renderProjectFolder() {
  const mode = projectLocationMode();
  $("project-folder-label").textContent = t(mode === "browser" ? "存储位置"
    : mode === "app-private" || mode === "mobile" ? "应用文档目录" : "本机目录");
  $("project-folder").textContent = projectPathDisplay(state.project?.folder_display || state.project?.folder || "");
  $("project-copy-path").hidden = mode === "browser";
}

function setProjectMessage(message) {
  $("project-message").dataset.message = message;
  $("project-message").textContent = t(message);
}

function renderProjectMenu() {
  const menu = $("project-menu");
  menu.replaceChildren(new Option(t("临时工作区"), ""), new Option(t("新建项目…"), "__new__"));
  for (const project of state.projects) menu.add(new Option(project.title, project.id));
  menu.value = state.project?.id || "";
}

function projectTime(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString(locale()) : "—";
}

function renderProjectHistory() {
  const project = state.project;
  for (const id of ["active-project-title", "active-project-location", "project-save", "project-history"]) $(id).hidden = !project;
  if (!project) return;
  const prompts = project.prompts || [];
  const runs = project.runs || [];
  const exports = project.exports || [];
  const versions = new Map(prompts.map((prompt, index) => [prompt.id, index + 1]));
  $("project-history-count").textContent = countText(prompts.length, "个版本", "版本数") + " · "
    + countText(runs.length, "次运行", "运行数");
  renderProjectFolder();
  $("project-prompts").innerHTML = [...prompts].reverse().map((prompt) =>
    '<details class="project-entry"><summary>' + esc(t("版本")) + ' ' + versions.get(prompt.id) + ' · '
      + esc(projectTime(prompt.created_at)) + '</summary><pre tabindex="0">' + esc(prompt.text) + '</pre>'
      + '<button type="button" class="button compact" data-project-prompt="' + esc(prompt.id) + '">'
      + esc(t("载入此版本")) + '</button></details>').join("")
    || '<p class="fine-print">' + esc(t("尚无已保存的讨论版本。")) + '</p>';
  const runStatus = { running: "运行中", succeeded: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断" };
  $("project-runs").innerHTML = [
    ...runs.map((run) => '<article class="project-entry"><strong>' + esc(t(runStatus[run.status] || run.status))
      + '</strong> · ' + esc(projectTime(run.created_at))
      + '<p class="muted">' + esc(t("版本")) + ' ' + esc(versions.get(run.prompt_id) || "—")
      + (run.provider?.model ? ' · ' + esc(run.provider.model) : '')
      + (run.error_code ? ' · ' + esc(run.error_code) : '') + '</p>'
      + (run.status === "succeeded" ? '<button type="button" class="button compact" data-project-run="' + esc(run.id) + '">'
        + esc(t("载入此几何")) + '</button>' : '') + '</article>'),
    ...exports.map((item) => '<article class="project-entry"><strong>' + esc(t("已导出")) + '</strong> · '
      + esc(projectTime(item.created_at)) + '</article>'),
  ].join("") || '<p class="fine-print">' + esc(t("尚无提取或导出记录。")) + '</p>';
}

function updateProjectDetails(project) {
  if (state.project?.id !== project.id) return;
  state.project = project;
  const index = state.projects.findIndex((item) => item.id === project.id);
  const { id, title, updated_at, folder } = project;
  if (index >= 0) state.projects.splice(index, 1);
  state.projects.unshift({ id, title, updated_at, folder });
  renderProjectMenu();
  renderProjectHistory();
  updateControls();
}

async function refreshProjectIndex() {
  const result = await api("/api/projects");
  state.projects = result.projects || [];
  renderProjectMenu();
}

let projectRefreshSequence = 0;
async function refreshProjectAfterRun(id, waitForCancellation = false) {
  const sequence = ++projectRefreshSequence;
  const delays = waitForCancellation ? [0, 1000, 1800] : [0];
  try {
    for (const delay of delays) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (state.project?.id !== id || sequence !== projectRefreshSequence) return;
      const project = await api(projectURL(id));
      if (sequence !== projectRefreshSequence) return;
      updateProjectDetails(project);
      if (project.runs[0]?.status !== "running") return;
    }
  } catch {
    if (state.project?.id === id && sequence === projectRefreshSequence) {
      setProjectMessage("未能刷新项目记录。可以手动刷新。");
    }
  }
}

function currentProjectDraft() {
  const { text, model, provenance, review_pending } = projectDocument();
  const draft = { text, model, provenance, review_pending };
  if (jsonDirty()) draft.json_text = jsonInput.value;
  return draft;
}

function discardProjectEdits() {
  const project = state.project;
  if (!project) return true;
  const saved = { ...project.draft, provenance: publicProvenance(project.draft.provenance) };
  const unchanged = sameValue(currentProjectDraft(), saved) && $("project-title-input").value.trim() === project.title;
  return unchanged || window.confirm(t("当前项目有未保存的修改。切换项目并放弃这些修改？"));
}

async function activateLocalProject(project) {
  if (project) await openProject(project.draft, false);
  else commit({ model: null, report: null }, false);
  projectRefreshSequence++;
  state.project = project;
  try { if (project) localStorage.setItem("detweave.activeProject", project.id); else localStorage.removeItem("detweave.activeProject"); } catch {}
  history.length = 0;
  $("project-history").open = false;
  $("examples").value = "";
  clearRunMonitor();
  if (project) {
    $("project-title-input").value = project.title;
    if (typeof project.draft.json_text === "string") jsonInput.value = project.draft.json_text;
    updateProjectDetails(project);
    setProjectMessage("已打开本地项目。");
  } else {
    renderProjectMenu();
    renderProjectHistory();
    setProjectMessage(projectStorageMessage());
  }
  render();
  if (typeof refreshConversation === "function") await refreshConversation(true);
}

function projectAction(label, work) {
  return run(label, async () => {
    setProjectMessage(label);
    try { await work(); } catch (error) {
      setProjectMessage(error.message);
      throw error;
    }
  });
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
    ? t("本浏览器已保存一份项目。清空工作台后仍可单独删除该副本。")
    : t("浏览器默认不保存讨论内容。项目 JSON 包含讨论原文。");
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
        status: "unresolved", quote: entry.quote, note: t("参数已修改，需重新核对该依据。"),
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
  if (state.reviewPending && !report.ready && sameValue(model, state.model)) throw new Error("请先根据已记录的答复修改 IR，或重新提取。");
  if (markChangedEvidence(model, state.model)) report = await validated(model);
  const text = isDirty() && model.source_text === state.model.source_text ? sourceInput.value : model.source_text;
  if ($("chat-input") && state.project) {
    const saved = await api(projectURL(state.project.id), {draft:{text,model,provenance:state.provenance,review_pending:false}});
    updateProjectDetails(saved);
    await refreshConversation(true);
  } else commit({ model, report, text, provenance: state.provenance });
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
  const line = t("用户确认") + " [" + path + "] = " + JSON.stringify(field.value);
  if ($("chat-input")) {
    prepareEvidenceConfirmation(path, field.value);
    return;
  }
  if (!window.confirm(t("确认采用以下几何参数，并将这条确认附到原文？") + "\n\n" + line)) {
    notify("确认已取消。");
    return;
  }
  const model = clone(state.model);
  model.source_text = appendSource(model.source_text, line);
  model.evidence[path] = {
    status: "confirmed", quote: line, note: t("用户在 DetWeave 参数面板确认了此值。"),
  };
  const report = await validated(model);
  commit({ model, report, provenance: state.provenance, reviewPending: state.reviewPending && !report.ready });
  notify("已记录此参数的用户确认。", "success");
}

async function answerQuestion(index, action) {
  const question = state.model.questions[index];
  const answer = $("answer-" + index).value.trim();
  if (!answer) throw new Error("请填写该问题的答复。");
  if (action === "record" && isDirty()) throw new Error("请先处理已修改的原文。");
  const line = t("补充答复") + " [" + question.id + "]\n" + t("问题：") + " " + question.question + "\n" + t("答复：") + " " + answer;
  const text = appendSource(sourceInput.value, line);
  if (action === "extract") {
    remember();
    sourceInput.value = text;
    renderSummary();
    updateControls();
    if (await extractGeometry(text)) history.pop();
    return;
  }
  if (!window.confirm(t("记录此答复并移出待澄清项？后续需要应用 IR 修改或重新提取。"))) {
    notify("记录已取消。");
    return;
  }
  const model = clone(state.model);
  model.source_text = text;
  model.questions.splice(index, 1);
  const fields = fieldsFor(model);
  for (const target of question.targets) {
    if (fields.has(target)) model.evidence[target] = {
      status: "unresolved", quote: "", note: t("已补充答复，请将答复应用到此参数并复核。"),
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
  if (projectLocationMode() === "browser") {
    document.querySelector(".identity").setAttribute("href", "#main-title");
    $("schema-link").setAttribute("href", "#main-title");
    $("schema-link").removeAttribute("target");
    $("schema-link").addEventListener("click", (event) => {
      event.preventDefault();
      run("正在准备 IR Schema…", async () => {
        const schema = await api("/api/schema");
        if (await download(JSON.stringify(schema, null, 2), "application/schema+json", "detweave-schema.json")) {
          notify("IR Schema 已下载。", "success");
        }
      });
    });
  }
  renderProviderMenu();
  setProvider(true);
  restoreProviderPreferences();
  renderProjectMenu();
  setProjectMessage(projectStorageMessage());
  refreshProjectIndex().catch(() => setProjectMessage("未能读取本地项目列表。"));
  refreshProjectLocations().catch(() => { /* The create dialog retries and reports errors. */ });
  refreshLocalSave();
  render();
  await run("正在加载内置示例…", async () => {
    let stored = null;
    try { stored = localStorage.getItem(saveKey); } catch { /* Storage can be disabled. */ }
    const data = await api("/api/examples");
    state.examples = Array.isArray(data) ? data : (data.examples || []);
    const menu = $("examples");
    for (const example of state.examples) menu.add(new Option(example.title, example.id));
    let activeProjectId;
    try { activeProjectId = localStorage.getItem("detweave.activeProject"); } catch {}
    if (activeProjectId && document.getElementById("chat-input")) {
      try { await activateLocalProject(await api(projectURL(activeProjectId))); return; }
      catch { try { localStorage.removeItem("detweave.activeProject"); } catch {} }
    }
    if (stored) {
      await openProject(JSON.parse(stored), false);
      notify("已恢复本浏览器保存的项目。", "success");
    } else if (!document.getElementById("chat-input") && state.examples[0]) {
      const first = state.examples[0];
      await loadExample(first, false);
      menu.value = first.id;
    } else {
      notify("输入讨论原文或导入项目以开始。");
    }
  });
}

$("language").addEventListener("change", () => {
  const pendingAnswers = [...document.querySelectorAll("#issues textarea")].map((input) => [input.id, input.value]);
  window.DetWeaveI18n?.apply($("language").value, true);
  renderProviderMenu();
  setProvider();
  renderProjectMenu();
  renderProjectLocationMenu();
  renderProjectHistory();
  refreshLocalSave();
  render();
  for (const [id, value] of pendingAnswers) if ($(id)) $(id).value = value;
  for (const id of ["status", "json-error", "project-message", "run-stage", "run-message", "run-activity"]) {
    const node = $(id);
    const text = node.dataset.message || node.dataset.label;
    if (text) node.textContent = t(text);
  }
  for (const entry of $("run-log").querySelectorAll("[data-message]")) entry.textContent = t(entry.dataset.message);
});

$("about-open").addEventListener("click", () => $("about-dialog").showModal());
$("project-menu").addEventListener("change", (event) => {
  const selected = event.target.value;
  event.target.value = state.project?.id || "";
  if (!discardProjectEdits()) return;
  if (selected === "__new__") {
    $("project-create-name").value = "";
    $("project-create-error").textContent = "";
    $("project-location-path-input").value = "";
    $("project-location-register").open = false;
    renderProjectLocationMenu("");
    $("project-create-dialog").showModal();
    $("project-create-name").focus();
    refreshProjectLocations().catch((error) => {
      if ($("project-create-dialog").open) $("project-create-error").textContent = t(error.message);
    });
    return;
  }
  projectAction("正在打开本地项目…", async () => activateLocalProject(selected ? await api(projectURL(selected)) : null));
});
$("project-create-cancel").addEventListener("click", () => $("project-create-dialog").close());
$("project-create-dialog").addEventListener("cancel", (event) => { if (state.busy) event.preventDefault(); });
$("project-create-location").addEventListener("change", showSelectedProjectLocation);
$("project-location-browse").addEventListener("click", () => projectLocationAction("正在打开文件夹选择器…", async () => {
  const location = typeof window.DetWeaveSelectProjectFolder === "function"
    ? await window.DetWeaveSelectProjectFolder()
    : await api(projectLocationsURL + "/pick", {});
  if (location && !location.cancelled) {
    acceptProjectLocation(location);
    if (projectLocationMode() === "browser") await refreshProjectIndex();
  }
}));
$("project-location-register-button").addEventListener("click", () => projectLocationAction("正在检查文件夹…", async () => {
  const path = $("project-location-path-input").value.trim();
  if (!path) throw new Error("请输入现有文件夹的绝对路径。");
  acceptProjectLocation(await api(projectLocationsURL, { path }));
  $("project-location-path-input").value = "";
  $("project-location-register").open = false;
}));
$("project-location-path-input").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  $("project-location-register-button").click();
});
$("project-create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const title = $("project-create-name").value.trim();
  if (!title) {
    $("project-create-error").textContent = t("请输入项目标题。");
    return;
  }
  const location = selectedProjectLocation();
  if (!location) {
    $("project-create-error").textContent = t("请选择创建位置。");
    return;
  }
  projectAction("正在创建本地项目…", async () => {
    try {
      const project = await api("/api/projects", { title, location_id: location.id });
      rememberProjectLocation(location.id);
      await activateLocalProject(project);
      $("project-create-dialog").close();
      setProjectMessage("已创建本地项目。");
    } catch (error) {
      $("project-create-error").textContent = t(error.message);
      throw error;
    }
  });
});
$("project-save").addEventListener("click", () => projectAction("正在保存本地项目…", async () => {
  const title = $("project-title-input").value.trim();
  if (!title) throw new Error("请输入项目标题。");
  projectRefreshSequence++;
  const project = await api(projectURL(state.project.id), { title, draft: currentProjectDraft() });
  $("project-title-input").value = project.title;
  updateProjectDetails(project);
  setProjectMessage("已保存本地项目。");
}));
$("project-refresh").addEventListener("click", () => projectAction("正在刷新项目记录…", async () => {
  projectRefreshSequence++;
  updateProjectDetails(await api(projectURL(state.project.id)));
  setProjectMessage("已刷新本地项目记录。");
}));
$("project-copy-path").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.project.folder);
    setProjectMessage("已复制项目目录。");
  } catch {
    setProjectMessage("无法自动复制。可选中目录路径并手动复制。");
  }
});
$("project-prompts").addEventListener("click", (event) => {
  const button = event.target.closest("[data-project-prompt]");
  const prompt = state.project?.prompts.find((item) => item.id === button?.dataset.projectPrompt);
  if (!prompt || state.busy) return;
  remember();
  sourceInput.value = prompt.text;
  renderSummary();
  updateControls();
  setProjectMessage("已将历史讨论版本载入原文。");
});
$("project-runs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-project-run]");
  if (!button) return;
  projectAction("正在载入历史几何…", async () => {
    const run = await api(projectURL(state.project.id) + "/runs/" + encodeURIComponent(button.dataset.projectRun));
    if (!run.result?.model) throw new Error("此运行没有可载入的几何。");
    const report = await validated(run.result.model);
    commit({ model: run.result.model, report, provenance: publicProvenance(run.result.provenance) });
    setProjectMessage("已载入历史几何。可保存为当前项目草稿。");
  });
});

$("provider").addEventListener("change", changeProviderPreference);
$("ark-model-select").addEventListener("change", selectPresetModel);
$("model-name").addEventListener("input", updateThinkingOptions);

for(const id of ['api-key','model-name','ark-model-select','ark-thinking','total-timeout']) {
  $(id).addEventListener('input',scheduleProviderSave);
  $(id).addEventListener('change',()=>{providerPreferences.generation++;flushProviderSave();});
}
$("base-url").addEventListener('input',()=>{
  if($("api-key").value){$("api-key").value='';}
  scheduleProviderSave();
});
$("base-url").addEventListener('change',()=>{providerPreferences.generation++;flushProviderSave();});
$("provider-forget").addEventListener('click',()=>{
  clearTimeout(providerPreferences.timer);providerPreferences.timer=null;
  const id=$("provider").value;providerPreferences.generation++;
  providerPreferences.touched.add(id);delete providerPreferences.profiles[id];applyProviderProfile(id);
  queueProviderSave({active:id,forget:id});
});
$("language").addEventListener('change',()=>{
  const node=$("provider-save-status");if(node.dataset.message)node.textContent=t(node.dataset.message);
});

$("run-toggle").addEventListener("click", () => toggleRunMonitor($("run-monitor").hidden));
function closeRunMonitor() {
  toggleRunMonitor(false);
  $("run-toggle").focus({ preventScroll: true });
}
$("run-close").addEventListener("click", closeRunMonitor);
$("run-monitor").addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeRunMonitor();
});
$("run-cancel").addEventListener("click", () => {
  if (!activeExtraction) return;
  $("run-cancel").disabled = true;
  setRunMessage("正在取消提取…");
  $("run-close").focus({ preventScroll: true });
  activeExtraction.controller.abort();
});
sourceInput.addEventListener("input", () => { renderSummary(); updateControls(); });
jsonInput.addEventListener("input", () => { renderSummary(); updateControls(); });
$("extract").addEventListener("click", () => run("正在提取几何草稿…", () => extractGeometry(sourceInput.value)));
$("examples").addEventListener("change", () => {
  const example = state.examples.find((item) => item.id === $("examples").value);
  if (example && $("chat-input")) {
    $("chat-input").value = example.text;
    $("chat-input").focus();
    updateChatControls();
  } else if (example) run("正在加载示例…", () => loadExample(example));
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
  if (button && button.dataset.questionAction === "extract" && $("chat-input")) {
    const index = Number(button.dataset.index);
    const answer = $("answer-" + index).value.trim();
    if (!answer) { notify("请填写该问题的答复。", "error"); return; }
    $("chat-input").value = t("问题：") + " " + state.model.questions[index].question + "\n" + t("答复：") + " " + answer;
    $("chat-input").focus();
    updateChatControls();
  } else if (button) run("正在处理答复…", () => answerQuestion(Number(button.dataset.index), button.dataset.questionAction));
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
    $("json-error").dataset.message = error.message;
    $("json-error").textContent = t(error.message);
    throw error;
  }
}));
$("reset-json").addEventListener("click", () => {
  jsonInput.value = state.jsonCommitted;
  $("json-error").textContent = "";
  delete $("json-error").dataset.message;
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
  clearRunMonitor();
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
  const projectId = state.project?.id;
  const blob = await api("/api/export", { model: state.model, provenance: publicProvenance(state.provenance), project_id: projectId }, true);
  const saved = await download(blob, "application/zip", "detweave-geometry.zip");
  if (projectId) refreshProjectAfterRun(projectId);
  if (saved) notify("几何包已下载。", "success");
}));

initialize();
