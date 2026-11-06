"use strict";

window.DetWeaveI18n = (() => {
  const storageKey = "detweave.language";
  const english = new Map(`
DetWeave · 探测器几何工作台	DetWeave · Detector Geometry Workbench
从设计讨论提取探测器几何，核对参数来源并导出。	Extract detector geometry from design discussions, review its evidence, and export it.
DetWeave 首页	DetWeave home
本地工作台	Local workbench
界面语言	Interface language
导入项目	Import project
探测器几何工作台	Detector geometry workbench
把设计讨论整理成可追溯的几何草稿，在导出前核对结构、尺寸与原文依据。	Turn design discussions into a traceable geometry draft. Review its structure, dimensions, and source evidence before exporting.
盒体 / 全圆管	Boxes / full tubes
设计讨论	Design discussion
讨论原文和补充说明	Source text and clarifications
示例	Example
加载示例	Load example
选择一个示例	Choose an example
设计讨论原文	Design discussion source
粘贴关于尺寸、材料、摆放和重复阵列的设计讨论。	Paste a discussion of dimensions, materials, placements, and repeated arrays.
提取方式	Extraction provider
离线演示 · 固定示例	Offline demo · fixed examples
火山 Coding Plan · OpenAI 兼容	Volcengine Coding Plan · OpenAI-compatible
OpenAI / 兼容接口	OpenAI / compatible API
Anthropic / 兼容接口	Anthropic / compatible API
可选	Optional
使用服务端默认地址	Use the server default
订阅模型	Subscription model
模型菜单	Model list
ark-code-latest · 跟随控制台 / Auto	ark-code-latest · Console setting / Auto
glm-latest · glm-5.3 别名	glm-latest · alias for glm-5.3
手动输入模型 ID…	Enter model ID manually…
13 个模型 + 路由入口 + 别名。核对于 2026-11-06；实际权限以账号及区域为准。	13 models plus a router and an alias. Checked 2026-11-06. Access depends on account and region.
官方模型清单 ↗	Official model list ↗
模型 ID	Model ID
输入所用模型 ID	Enter your model ID
仅本次会话	Current page only
输入该服务的 API Key	Enter this provider's API key
提取总时限	Total extraction timeout
秒	seconds
60–900 秒。服务商连接与无数据等待另有时限。	60–900 seconds. Connection and idle limits apply separately.
深度思考	Thinking
默认（由服务商决定）	Default (provider setting)
关闭深度思考	Disable thinking
开启深度思考	Enable thinking
显式开关需模型支持。接口拒绝时会显示错误。	The model must support this setting. Rejected requests display an error.
仅匹配内置合成示例，适合离线体验。	Runs offline with the built-in synthetic examples.
提取几何草稿	Extract geometry draft
正在加载内置示例…	Loading built-in examples…
运行过程 / Thinking	Run monitor
运行过程	Run monitor
取消提取	Cancel extraction
收起运行过程	Collapse run monitor
收起	Collapse
阶段	Stage
待运行	Idle
已用时	Elapsed
距服务商数据	Since provider data
开始提取后会在这里显示进度。	Extraction progress appears here.
服务商返回的思考内容	Thinking returned by the provider
尚未收到服务商公开的思考内容。	No provider-exposed thinking received yet.
已达到 200,000 字符显示上限。	The 200,000-character display limit was reached.
几何 JSON 片段	Geometry JSON fragments
尚未收到输出片段。	No output fragments received yet.
已达到 200,000 字符显示上限。最终结果将单独校验。	The 200,000-character display limit was reached. The final result is validated separately.
事件日志	Event log
最近 100 条	Last 100 events
本地心跳只表示页面仍在等待。此面板仅保留本页最近一次运行，不写入项目文件。	Local heartbeats indicate that the page is waiting. This panel keeps only the latest run on the current page, outside project files.
几何预览	Geometry preview
等待设计模型	Waiting for a geometry model
待提取	Awaiting extraction
视图	View
正视 XZ	Front XZ
侧视 YZ	Side YZ
端视 XY	End XY
复位视角	Reset view
探测器三维预览。用方向键旋转，用加减键缩放，Home 键复位。	3D detector preview. Use arrow keys to orbit, plus or minus to zoom, and Home to reset.
加载示例或提取草稿，开始查看几何	Load an example or extract a draft to preview geometry
拖动旋转 · 滚动缩放	Drag to orbit · Scroll to zoom
材料图例	Material legend
导出 SVG	Export SVG
下载离线 3D	Download offline 3D
验证状态	Validation status
结构与核查	Structure and review
逐项追溯参数来源，处理导出阻塞	Review parameter evidence and resolve export blockers
重新验证	Revalidate
结构树	Structure tree
0 实例	0 instances
当前没有几何模型。	There is no geometry model yet.
参数与依据	Parameters and evidence
选中结构或投影中的对象，查看尺寸、材料和证据。	Select an object in the tree or projection to inspect its dimensions, material, and evidence.
待核查	Review items
提取或导入模型后显示验证结果。	Extract or import a model to see validation results.
编辑几何 IR	Edit geometry IR
几何模型 JSON	Geometry model JSON
应用前校验结构。修改几何值后，重新核对对应字段的依据。	The schema is checked before changes are applied. Review the evidence for any geometry value you change.
还原编辑框	Reset editor
验证并应用	Validate and apply
项目与导出	Project and export
几何通过结构、解析几何及证据检查后可导出。	Export is available after schema, analytic geometry, and evidence checks pass.
撤销上一步	Undo
清空	Clear
保存到本浏览器	Save in this browser
下载项目 JSON	Download project JSON
导出几何包 ↓	Export geometry bundle ↓
浏览器默认不保存讨论内容。项目 JSON 包含讨论原文。	Discussion text is saved in the browser only on request. Project JSON includes the source discussion.
删除浏览器副本	Delete browser copy
世界坐标 · 毫米 · 平移放置	World coordinates · Millimeters · Translations
关于与署名	About and attribution
关于 DetWeave	About DetWeave
关闭	Close
作者与联系	Author and contact
许可与引用	License and citation
DetWeave 供非商业使用。使用时请保留作者署名，并在研究成果中引用本项目。具体条款见项目许可。	DetWeave is available for noncommercial use. Retain author attribution and cite the project in research outputs. See the project license for the terms.
项目主页与引用信息 ↗	Project homepage and citation ↗
连接本地服务	Connecting to local service
请求已接收	Request received
排队等待	Queued
准备提取	Preparing extraction
连接服务商	Connecting to provider
等待服务商数据	Waiting for provider data
收到服务商数据	Provider data received
等待整段响应	Waiting for full response
解析几何 JSON	Parsing geometry JSON
收到思考片段	Receiving thinking
接收几何 JSON	Receiving geometry JSON
服务端重试	Server retry
校验提取结果	Validating result
已完成	Completed
失败	Failed
已取消	Canceled
原文给定	Stated in source
已确认	Confirmed
推导待审	Derivation to review
待确认假设	Unconfirmed assumption
待澄清	Clarification needed
缺少依据	Missing evidence
无法连接本地服务，请检查 DetWeave 是否仍在运行。	Could not connect to the local service. Check that DetWeave is running.
本地服务返回 HTTP	Local service returned HTTP
有尚未应用的原文修改	Unapplied source edits
字符	characters
原文已有修改，请提取或同步更新 IR。	Source text changed. Extract again or update the IR.
IR 编辑框有未应用的修改。请应用或还原。	The IR editor has unapplied changes. Apply or reset them.
已记录答复，请修改 IR 并验证，或重新提取。	A clarification was recorded. Update and validate the IR, or extract again.
可导出当前模型。Geant4 与 DD4hep 运行检查未执行。	The current model can be exported. Geant4 and DD4hep runtime checks have not been run.
提取时会将讨论原文发送到所选服务。密钥只保留在当前页面内存中。	Extraction sends the source discussion to the selected provider. The key stays in this page's memory.
ark-code-latest 跟随控制台设置；控制台选为 Auto 时自动路由。也可从菜单选择具体模型或手动输入 ID。	ark-code-latest follows the console setting and routes automatically when the console is set to Auto. Choose a specific model or enter an ID manually.
该模型默认开启思考，官方说明不支持关闭。已使用默认或开启模式。	This model enables thinking by default and does not support disabling it. The current setting uses the default or enables thinking.
IR 结构校验失败。	IR schema validation failed.
请输入设计讨论原文。	Enter the design discussion.
单次提取最多支持 30,000 字符。请拆分讨论。	Each extraction supports up to 30,000 characters. Split the discussion into smaller parts.
请输入模型 ID。	Enter a model ID.
请填写有效的 Base URL。	Enter a valid base URL.
提取总时限需为 60–900 秒之间的整数。	Set a whole-number timeout between 60 and 900 seconds.
流式响应未包含完整的几何模型与验证结果。	The stream did not contain a complete model and validation report.
提取结果的 IR 结构无效。	The extracted IR failed schema validation.
已提取并通过当前导出检查。	Extraction completed and the current export checks passed.
已提取草稿。请核对待审项目。	Draft extracted. Review the outstanding items.
已取消当前提取请求，保留当前模型。	Extraction canceled. The current model was retained.
保留当前模型。	The current model was retained.
离线演示	Offline demo
尚未收到	None received
运行中	Running
正在等待本地服务接收请求。	Waiting for the local service to accept the request.
发起提取请求。	Extraction requested.
本地心跳 · 等待下一条数据。	Local heartbeat · Waiting for the next data.
收到服务商公开的思考片段。	Received thinking exposed by the provider.
收到首个几何 JSON 片段。	Received the first geometry JSON fragment.
服务商响应信息	Provider response metadata
流式响应中的单条事件过大。	A stream event exceeded the size limit.
本地服务返回了无效的流式事件。	The local service returned an invalid stream event.
无法连接本地流式服务，请检查 DetWeave 是否仍在运行。	Could not connect to the local streaming service. Check that DetWeave is running.
本地服务没有流式提取接口。请重启新版 DetWeave。	The local service does not offer streaming extraction. Restart the updated DetWeave service.
本地服务未返回 NDJSON 流式响应。	The local service did not return an NDJSON stream.
流式连接意外中断。	The stream disconnected unexpectedly.
流式响应包含无效的 UTF-8 数据。	The stream contains invalid UTF-8.
服务端报告流式提取失败。	The server reported an extraction failure.
流式连接已结束，未收到最终提取结果。	The stream ended before a final extraction result arrived.
实例	instance
实例数	instances
未展开	Unexpanded
根节点	Root
体积定义	Volume definitions
World 尺寸	World dimensions
World 材料	World material
形状与尺寸	Shape and dimensions
材料	Material
体积引用	Volume reference
父放置	Parent placement
局部坐标	Local position
重复阵列	Repeating array
暂无原文引句。	No source quote yet.
引句未出现在原文中。	The quote is absent from the source.
记录此值已确认	Confirm this value
盒体 XYZ	Box XYZ
内半径	Inner radius
外半径	Outer radius
Z 全长	Full Z length
世界坐标	World position
重复 / 步进	Repeat / step
世界	World
定义	Definition
放置	Placement
IR 结构	IR schema
非有限数值	Non-finite value
标识符	Identifier
半径关系	Radius relationship
引用	Reference
重复父放置	Repeated parent
层级	Hierarchy
无放置	No placements
体积未放置	Unplaced volume
待确认	Confirmation needed
原文不匹配	Source mismatch
越界	Outside parent
相交	Overlap
相交汇总	Overlap summary
项	items
答复	Answer
填写设计方的答复	Enter the designer's answer
补充并提取	Append and extract
记录答复并移出问题。仍需修改 IR 或重新提取。	Record the answer and remove the question. Then update the IR or extract again.
记录答复	Record answer
模型备注	Model note
当前检查没有发现导出阻塞项。	The current checks found no export blockers.
可导出	Exportable
草稿	Draft
结构	Schema
解析几何	Analytic geometry
证据	Evidence
通过	Passed
有错误	Failed
待审	Review needed
未运行	Not run
未执行	Not run
提取记录	Extraction record
接口返回	Provider returned
原始提取输入 SHA-256	Original extraction input SHA-256
几何投影，单位毫米	geometry projection, millimeters
没有可预览的放置，请查看验证结果。	There are no placements to preview. Check the validation results.
选中对象 · 查看尺寸	Select an object · View dimensions
下载	Download
投影	projection
离线 3D	Offline 3D
几何可视化 · 毫米 · Geant4 / DD4hep 运行验证未执行	Geometry visualization · Millimeters · Geant4 / DD4hep runtime checks not run
探测器三维预览，方向键旋转，加减键缩放	3D detector preview. Use arrow keys to orbit and plus or minus to zoom.
拖动或方向键旋转 · 滚轮或加减键缩放 · 点击选中对象	Drag or use arrow keys to orbit · Scroll or use plus/minus to zoom · Click to select an object
请选择 DetWeave 项目 JSON 或几何 IR。	Choose a DetWeave project JSON or geometry IR file.
项目的 IR 必须是 JSON 对象。	The project's IR must be a JSON object.
项目缺少 IR 和讨论原文。	The project is missing both IR and source discussion.
项目原文必须为不超过 100,000 字符的文本。	The project source must be text of at most 100,000 characters.
本浏览器已保存一份项目。清空工作台后仍可单独删除该副本。	A project copy is saved in this browser. You can delete that copy separately after clearing the workbench.
参数已修改，需重新核对该依据。	The parameter changed. Review its evidence again.
JSON 无法解析，请检查括号、引号和逗号。	Could not parse JSON. Check brackets, quotation marks, and commas.
请先根据已记录的答复修改 IR，或重新提取。	Update the IR using the recorded answer or extract again.
IR 已应用，当前检查通过。	IR applied and the current checks passed.
IR 已应用，仍有待核查项。	IR applied. Some items still need review.
追加后原文会超过 100,000 字符。请先精简原文。	The addition would make the source exceed 100,000 characters. Shorten the source first.
请先提取或应用已修改的原文。	Extract or apply the updated source text first.
没有找到该参数。	The parameter was not found.
用户确认	User confirmation
确认采用以下几何参数，并将这条确认附到原文？	Use the following geometry parameter and append this confirmation to the source?
确认已取消。	Confirmation canceled.
用户在 DetWeave 参数面板确认了此值。	The user confirmed this value in the DetWeave parameter panel.
已记录此参数的用户确认。	Confirmation for this parameter recorded.
请填写该问题的答复。	Enter an answer to this question.
请先处理已修改的原文。	Apply or extract the changed source text first.
补充答复	Clarification
问题：	Question: 
答复：	Answer: 
记录此答复并移出待澄清项？后续需要应用 IR 修改或重新提取。	Record the answer and remove this question? You will still need to apply IR changes or extract again.
记录已取消。	Recording canceled.
已补充答复，请将答复应用到此参数并复核。	A clarification was added. Apply it to this parameter and review the evidence.
已记录答复。请应用 IR 修改或重新提取。	Answer recorded. Apply changes to the IR or extract again.
已加载内置合成示例。	Built-in synthetic example loaded.
已恢复本浏览器保存的项目。	Restored the project saved in this browser.
输入讨论原文或导入项目以开始。	Enter the source discussion or import a project to begin.
正在取消提取…	Canceling extraction…
正在提取几何草稿…	Extracting geometry draft…
正在加载示例…	Loading example…
正在记录确认…	Recording confirmation…
正在处理答复…	Processing answer…
正在验证模型…	Validating model…
当前模型检查通过。	The current model passed validation.
验证完成。请查看待核查项。	Validation completed. Review the outstanding items.
正在验证修改后的 IR…	Validating edited IR…
已撤销上一步。	Last action undone.
工作台已清空。可撤销此操作。	Workbench cleared. You can undo this action.
正在保存项目…	Saving project…
无法在本浏览器保存项目，可以下载项目 JSON。	Could not save the project in this browser. You can download its JSON.
已保存到本浏览器。	Project saved in this browser.
正在删除浏览器副本…	Deleting browser copy…
已删除浏览器副本。	Browser copy deleted.
正在导入项目…	Importing project…
项目 JSON 超过 8 MB。	Project JSON exceeds 8 MB.
无法读取项目 JSON。	Could not read project JSON.
已导入并重新校验项目。	Project imported and revalidated.
正在生成几何包…	Preparing geometry bundle…
几何包已下载。	Geometry bundle downloaded.
请求已接收，正在启动模型调用。	Request received. Starting extraction.
校验内置合成示例；此模式不调用模型。	Validating the built-in synthetic example. This mode runs without a model call.
检查 Schema、来源、层级和几何约束。	Checking schema, source evidence, hierarchy, and geometry constraints.
连接模型服务商，等待响应头。	Connecting to the provider and waiting for response headers.
已收到服务商响应，等待模型数据。	Provider response received. Waiting for model data.
此接口返回整段响应，暂无法逐字显示；仍在等待服务商数据。	This endpoint returns a single buffered response. Waiting for the provider data.
模型输出已结束，正在解析几何 JSON。	Model output ended. Parsing the geometry JSON.
调用结束但没有完整结果。	The request ended without a complete result.
离线演示只识别内置示例。请加载示例，或配置模型 API 后解析自己的文本；不会把任意文本替换为演示几何。	The offline demo accepts built-in examples. Load an example, or configure a model API to extract your own discussion.
本地提取失败；没有接受部分几何。	Local extraction failed. Partial geometry was discarded.
本地服务未启用联网提取。	The local service has disabled online extraction.
服务商返回了不支持的文本片段格式。	The provider returned an unsupported text fragment.
完成标记后仍收到内容，未接受输出。	Content arrived after the completion marker. The output was rejected.
模型输出超过大小上限。	The model output exceeded its size limit.
服务商流式事件不是 JSON 对象。	The provider's stream event was not a JSON object.
服务商在流中返回错误。本次部分输出未被接受。	The provider returned a stream error. Partial output was discarded.
模型请求工具或拒绝生成，未接受几何。	The model requested tools or refused generation. The geometry was rejected.
不支持模型返回的内容类型。	The model returned an unsupported content type.
连接模型服务商超时（最多 20 秒），请检查网络和接口地址。	Provider connection timed out after up to 20 seconds. Check the network and endpoint.
无法连接服务商，请检查网络、TLS 证书和接口地址。	Could not connect to the provider. Check the network, TLS certificate, and endpoint.
模型连接中断或返回了不支持的流式格式；部分输出未被接受。	The provider disconnected or returned an unsupported stream format. Partial output was discarded.
请求已停止，未接受本次几何输出。	The request was stopped. Its geometry output was discarded.
请求连接已终止。	The connection was closed.
本地项目	Local project
临时工作区	Scratch workspace
新建项目…	New project…
项目标题	Project title
保存本地项目	Save local project
创建项目后，讨论版本与提取记录保存到本机目录。	Create a project to keep discussion versions and extraction records in a local folder.
提示词与运行记录	Prompt and run history
本机目录	Local folder
复制路径	Copy path
刷新记录	Refresh history
讨论版本	Discussion versions
提取与导出记录	Extraction and export history
新建本地项目	New local project
创建一个本机目录，用于保存讨论、几何和提取记录。	Create a local folder for the discussion, geometry, and extraction history.
取消	Cancel
创建项目	Create project
请输入项目标题。	Enter a project title.
个版本	version
版本数	versions
次运行	run
运行数	runs
版本	Version
载入此版本	Load this version
尚无已保存的讨论版本。	No discussion versions saved yet.
已中断	Interrupted
载入此几何	Load this geometry
已导出	Exported
尚无提取或导出记录。	No extraction or export records yet.
未能刷新项目记录。可以手动刷新。	Could not refresh project history. You can refresh it manually.
当前项目有未保存的修改。切换项目并放弃这些修改？	This project has unsaved changes. Switch projects and discard those changes?
已打开本地项目。	Local project opened.
未能读取本地项目列表。	Could not load the local project list.
正在打开本地项目…	Opening local project…
正在创建本地项目…	Creating local project…
已创建本地项目。	Local project created.
正在保存本地项目…	Saving local project…
已保存本地项目。	Local project saved.
正在刷新项目记录…	Refreshing project history…
已刷新本地项目记录。	Local project history refreshed.
已复制项目目录。	Project folder copied.
无法自动复制。可选中目录路径并手动复制。	Could not copy automatically. You can select and copy the folder path.
已将历史讨论版本载入原文。	The historical discussion version was loaded into the source editor.
正在载入历史几何…	Loading historical geometry…
此运行没有可载入的几何。	This run has no geometry to load.
已载入历史几何。可保存为当前项目草稿。	Historical geometry loaded. You can save it as the current project draft.
原生保存失败，正在尝试浏览器下载。	Native save failed. Trying a browser download.
暂无事件。	No events yet.
`.trim().split("\n").map((line) => line.split("\t")));
  let language = "zh-CN";
  try { if (localStorage.getItem(storageKey) === "en") language = "en"; } catch { /* Browser storage is optional. */ }

  function translate(message) {
    if (language !== "en" || typeof message !== "string") return message;
    if (english.has(message)) return english.get(message);
    const formatted = [
      [/^本地服务返回 HTTP (\d+)$/, (_, code) => "Local service returned HTTP " + code],
      [/^服务商 HTTP (\d+)，1 秒后重试一次。$/, (_, code) => "Provider HTTP " + code + ". The server will retry once after 1 second."],
      [/^达到总耗时上限（([\d.]+) 秒）。部分输出未作为几何接受；可调整总时限或思考模式后重试。$/, (_, seconds) => "Total timeout of " + seconds + " seconds reached. Partial output was discarded. You can adjust the timeout or thinking setting before retrying."],
      [/^服务商连续 ([\d.]+) 秒未返回新数据，连接已结束；已收到的部分输出未被接受。$/, (_, seconds) => "No provider data arrived for " + seconds + " seconds. The connection was closed and partial output discarded."],
    ];
    for (const [pattern, replacement] of formatted) {
      if (pattern.test(message)) return message.replace(pattern, replacement);
    }
    const eventCode = message.match(/^\[([a-z0-9_-]+)\] (.*)$/s);
    if (eventCode) return "[" + eventCode[1] + "] " + translate(eventCode[2]);
    const metadata = "服务商响应信息 · ";
    if (message.startsWith(metadata)) return english.get(metadata.slice(0, -3)) + " · " + message.slice(metadata.length);
    const suffix = " 保留当前模型。";
    if (message.endsWith(suffix)) return translate(message.slice(0, -suffix.length)) + " " + english.get(suffix.trim());
    return message;
  }

  // Snapshot only the shipped HTML, before app.js can insert any model or source data.
  const bindings = [];
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.data.trim();
      if (english.has(value)) {
        const [leading, trailing] = [node.data.match(/^\s*/)[0], node.data.match(/\s*$/)[0]];
        bindings.push(() => { if (node.isConnected) node.data = leading + translate(value) + trailing; });
      }
    } else {
      const attributes = ["aria-label", "placeholder", "data-empty", "title"];
      if (node.matches("meta[name=description]")) attributes.push("content");
      for (const attribute of attributes) {
        const value = node.getAttribute(attribute);
        if (english.has(value)) bindings.push(() => node.setAttribute(attribute, translate(value)));
      }
    }
  }

  function apply(value, remember = false) {
    language = value === "en" ? "en" : "zh-CN";
    document.documentElement.lang = language;
    for (const update of bindings) update();
    const selector = document.getElementById("language");
    if (selector) selector.value = language;
    if (remember) {
      try { localStorage.setItem(storageKey, language); } catch { /* Browser storage is optional. */ }
    }
  }
  apply(language);
  return { translate, apply, get language() { return language; } };
})();
