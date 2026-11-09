"use strict";

let conversation = {messages: [], revisions: [], current_revision_id: null};
let chatOperation = null;
let conversationProject = null;
let pendingEvidenceConfirmation = null;
const composerDrafts = new Map(); // Unsent text stays in memory only.
const chatLabel = (zh, en) => locale() === 'en' ? en : zh;
const conversationURL = () => projectURL(state.project.id) + '/conversation';

function updateChatControls() {
  if (!window.detweaveChatReady || !$("chat-send")) return;
  $("chat-send").disabled = state.busy || !$("chat-input").value.trim();
  $("chat-input").readOnly = state.busy;
  $("chat-stop").hidden = !chatOperation;
  $("chat-confirm-accept").disabled = state.busy || !pendingEvidenceConfirmation;
  $("chat-confirm-dismiss").disabled = state.busy;
  $("revision-select").disabled = state.busy;
  $("revision-restore").disabled = state.busy || !$("revision-select").value || $("revision-select").value === conversation.current_revision_id;
}

function renderConversation() {
  const log = $("chat-messages");
  log.replaceChildren();
  if (!conversation.messages.length) {
    const welcome = document.createElement('p');
    welcome.className = 'chat-welcome';
    welcome.textContent = chatLabel('创建或打开项目，然后粘贴讨论开始设计。后续可直接提出修改；不明确的尺寸会先向你确认。', 'Create or open a project, then paste a discussion to begin. Continue with changes; unclear dimensions will be clarified first.');
    log.append(welcome);
  }
  for (const message of conversation.messages) {
    const article = document.createElement('article');
    article.className = 'chat-message ' + (message.role === 'user' ? 'chat-user' : 'chat-assistant');
    article.dataset.messageId = message.id;
    const label = document.createElement('strong');
    label.textContent = message.role === 'user' ? chatLabel('你', 'You') : 'DetWeave';
    const text = document.createElement('div');
    text.className = 'chat-content';
    text.textContent = message.content || '';
    article.append(label, text);
    if (message.status && ['failed','cancelled','interrupted','running'].includes(message.status)) {
      const status = document.createElement('small');
      const labels = {failed:['失败','Failed'],cancelled:['已取消','Cancelled'],interrupted:['已中断','Interrupted'],running:['处理中','Processing']};
      status.textContent = chatLabel(...labels[message.status]);
      article.append(status);
    }
    if (message.revision_id) {
      const version = document.createElement('button');
      version.className = 'button compact chat-version';
      const index = conversation.revisions.findIndex(r => r.id === message.revision_id);
      version.textContent = chatLabel('几何版本 ', 'Geometry version ') + (index >= 0 ? 'v' + (index + 1) : message.revision_id);
      version.addEventListener('click', () => {$("revision-select").value = message.revision_id; showRevisionSummary();});
      article.append(version);
    }
    log.append(article);
  }
  const menu = $("revision-select"), selected = menu.value;
  menu.replaceChildren(new Option(chatLabel('选择历史版本…','Select a revision…'),''));
  conversation.revisions.forEach((revision,index) => {
    menu.add(new Option('v'+(index+1)+(revision.id === conversation.current_revision_id ? chatLabel(' · 当前',' · current') : ''),revision.id));
  });
  menu.value = conversation.revisions.some(r=>r.id===selected) ? selected : (conversation.current_revision_id || '');
  showRevisionSummary();
  $("artifact-json").textContent = state.model ? JSON.stringify(state.model,null,2) : chatLabel('尚无几何模型。','No geometry model yet.');
  log.scrollTop = log.scrollHeight;
  updateChatControls();
}

function showRevisionSummary() {
  const revision = conversation.revisions.find(r=>r.id===$("revision-select").value);
  const current = conversation.revisions.findIndex(r=>r.id===conversation.current_revision_id);
  $("revision-summary").textContent = (current >= 0 ? chatLabel('右侧显示当前版本 ','Viewing current revision ')+'v'+(current+1)+'. ' : '')
    +(revision?.summary || '')
    +(revision && revision.id!==conversation.current_revision_id ? chatLabel(' 选择历史版本不会改变当前几何，点击“恢复此版本”后继续。',' Selecting history does not change the geometry. Restore it to continue.') : '');
  const changes = revision?.changes;
  $("revision-changes").textContent = Array.isArray(changes) ? changes.map(change => typeof change === 'string' ? change : change.path ? change.path + ': ' + JSON.stringify(change.before) + ' → ' + JSON.stringify(change.after) : JSON.stringify(change)).join('\n') : changes ? JSON.stringify(changes,null,2) : chatLabel('无参数差异记录。','No parameter diff recorded.');
  updateChatControls();
}

function acceptConversation(value, geometry = true) {
  if (!value || !Array.isArray(value.messages) || !Array.isArray(value.revisions)) throw new Error(chatLabel('对话响应格式无效。','Invalid conversation response.'));
  conversation = value;
  pendingEvidenceConfirmation=null;
  $("chat-confirmation").hidden=true;
  if (geometry) {
    const revision = value.revisions.find(r=>r.id===value.current_revision_id);
    if (revision?.model && revision?.report) commit({model:clone(revision.model),report:clone(revision.report),provenance:publicProvenance(revision.provenance)},false);
  }
  renderConversation();
}

async function refreshConversation(geometry = false) {
  const id = state.project?.id || null;
  if (conversationProject !== id) {
    composerDrafts.set(conversationProject,$("chat-input").value);
    $("chat-input").value = composerDrafts.get(id) || (conversationProject === null ? composerDrafts.get(null) : '') || '';
    conversationProject = id;
    pendingEvidenceConfirmation=null;$("chat-confirmation").hidden=true;
    conversation = {messages:[],revisions:[],current_revision_id:null};
    renderConversation();
  }
  if (!id) return;
  const value = await api(conversationURL());
  if (state.project?.id === id) acceptConversation(value, geometry);
}

async function sendChat() {
  const text = $("chat-input").value.trim();
  if (!text || state.busy) return;
  if (!state.project) {
    $("chat-status").textContent = chatLabel('请先创建项目并选择保存位置。','Create a project and choose its storage location first.');
    $("project-menu").value = '__new__';
    $("project-menu").dispatchEvent(new Event('change'));
    return;
  }
  if (jsonDirty()) throw new Error(chatLabel('请先还原未应用的 IR 编辑。','Discard unapplied IR edits before sending.'));
  const current = conversation.revisions.find(r=>r.id===conversation.current_revision_id);
  if (current && !sameValue(state.model,current.model)) throw new Error(chatLabel('当前预览已在对话外修改。请重新打开项目以恢复当前对话版本，或将修改另存为新项目。','The preview was changed outside this conversation. Reopen the project to restore its current revision, or save the changes as a new project.'));
  const id = state.project.id;
  await run('正在处理设计对话…', async()=>{
    const operation = {controller:new AbortController(),started:performance.now(),stage:chatLabel('正在连接模型','Connecting to model')};
    chatOperation=operation;
    const update = ()=>{$("chat-status").textContent=operation.stage+' · '+durationLabel((performance.now()-operation.started)/1000);};
    operation.timer=setInterval(update,250);update();updateChatControls();
    const optimistic={id:'pending',role:'user',content:text,status:'running'};
    conversation.messages.push(optimistic);renderConversation();
    let success=false;
    try {
      const response=await fetch(conversationURL()+'/stream',{method:'POST',headers:{'Content-Type':'application/json','X-DetWeave':'1',Accept:'application/x-ndjson'},signal:operation.controller.signal,body:JSON.stringify({text,provider:configuredProvider(),base_revision_id:conversation.current_revision_id})});
      if(!response.ok) throw await responseError(response);
      if(!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) throw new Error(chatLabel('对话服务没有返回有效数据流。','The conversation service returned no valid event stream.'));
      const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',result;
      try {
        while(!result){
          const part=await reader.read();operation.controller.signal.throwIfAborted();buffer+=part.done?decoder.decode():decoder.decode(part.value,{stream:true});
          if(buffer.length>streamLineLimit) throw new Error('Conversation event exceeds size limit.');
          const lines=buffer.split('\n');buffer=part.done?'':lines.pop();
          for(const line of lines){
            const event=parseRunLine(line);if(!event)continue;
            if(event.type==='error') throw new Error(event.message||event.error||'Conversation failed.');
            if(event.type==='result'){result=event.result;break;}
            if(event.type==='status') operation.stage=event.stage==='validating'?chatLabel('正在检查几何','Checking geometry'):chatLabel('正在处理设计要求','Processing design request');
          }
          if(part.done&&!result) throw new Error(chatLabel('连接中断，没有接受部分几何。','Connection ended; no partial geometry was accepted.'));
        }
      }finally{reader.cancel().catch(()=>{});}
      operation.controller.signal.throwIfAborted();
      if(state.project?.id!==id)return;
      acceptConversation(result.conversation,true);
      $("chat-input").value='';composerDrafts.delete(id);
      success=true;
      $("chat-status").textContent=chatLabel('已保存对话','Conversation saved');
      updateProjectDetails(await api(projectURL(id)));
    }catch(error){
      optimistic.status = operation.controller.signal.aborted ? 'cancelled' : 'failed';
      renderConversation();
      $("chat-status").textContent=operation.controller.signal.aborted?chatLabel('已停止；保留当前几何和输入。','Stopped; current geometry and input retained.'):error.message;
      try {await refreshConversation(false);}catch{/* Keep visible input if backend is unavailable. */}
      if(!operation.controller.signal.aborted)notify(error.message,'error');
    }finally{
      clearInterval(operation.timer);chatOperation=null;updateChatControls();
      if(success) $("chat-status").textContent=chatLabel('已保存对话','Conversation saved');
      if(!success) {
        // A cancelled worker may finish persisting after the connection closes.
        setTimeout(()=>{if(state.project?.id===id&&!chatOperation)refreshConversation(false).catch(()=>{});},1200);
      }
    }
  });
}

$("chat-send").addEventListener('click',()=>sendChat().catch(e=>{$("chat-status").textContent=e.message;}));
$("chat-input").addEventListener('input',updateChatControls);
$("chat-input").addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$("chat-send").click();}});
$("chat-stop").addEventListener('click',()=>chatOperation?.controller.abort());
$("revision-select").addEventListener('change',showRevisionSummary);
$("revision-restore").addEventListener('click',()=>run('正在恢复几何版本…',async()=>{
  const revision_id=$("revision-select").value;if(!revision_id)return;
  const result=await api(conversationURL()+'/select',{revision_id});
  acceptConversation(result.conversation || result,true);
  updateProjectDetails(await api(projectURL(state.project.id)));
}));
for(const button of document.querySelectorAll('[data-artifact]'))button.addEventListener('click',()=>{
  for(const tab of document.querySelectorAll('[data-artifact]'))tab.setAttribute('aria-pressed',String(tab===button));
  document.querySelector('.geometry').hidden=button.dataset.artifact!=='preview';
  $("artifact-code").hidden=button.dataset.artifact!=='code';$("artifact-pdf").hidden=button.dataset.artifact!=='pdf';
  $("artifact-json").textContent=state.model?JSON.stringify(state.model,null,2):chatLabel('尚无几何模型。','No geometry model yet.');
  if(button.dataset.artifact==='preview'){renderDrawing();scene.draw();}
});
$("language").addEventListener('change',renderConversation);
window.detweaveChatReady = true;
renderConversation();

function prepareEvidenceConfirmation(path, value) {
  if (!state.project || !conversation.current_revision_id) {
    $("chat-status").textContent = chatLabel('请先在项目中创建几何版本。','Create a geometry revision in a project first.');
    return;
  }
  const current=conversation.revisions.find(r=>r.id===conversation.current_revision_id);
  if (!current || !sameValue(state.model,current.model) || jsonDirty()) {
    throw new Error(chatLabel('当前显示的几何与保存版本不一致，请先保存修改或重新打开项目。','The displayed geometry differs from the saved revision. Save changes or reopen the project first.'));
  }
  pendingEvidenceConfirmation={path,revision_id:conversation.current_revision_id,model:clone(state.model)};
  $("chat-confirmation-value").textContent=path+' = '+JSON.stringify(value);
  $("chat-confirmation").hidden=false;
  $("chat-confirm-accept").focus({preventScroll:true});
  updateChatControls();
}
$("chat-confirm-dismiss").addEventListener('click',()=>{pendingEvidenceConfirmation=null;$("chat-confirmation").hidden=true;updateChatControls();});
$("chat-confirm-accept").addEventListener('click',()=>run('正在记录确认…',async()=>{
  const pending=pendingEvidenceConfirmation;if(!pending)return;
  if (pending.revision_id!==conversation.current_revision_id || !sameValue(state.model,pending.model) || jsonDirty()) {
    throw new Error(chatLabel('确认期间几何已改变，请重新选择要确认的参数。','Geometry changed during confirmation. Select the parameter again.'));
  }
  const result=await api(conversationURL()+'/confirm',{revision_id:pending.revision_id,targets:[pending.path]});
  acceptConversation(result.conversation||result,true);
  updateProjectDetails(await api(projectURL(state.project.id)));
  $("chat-status").textContent=chatLabel('确认已保存为新版本。','Confirmation saved as a new revision.');
}));
