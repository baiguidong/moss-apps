import {createSettingsView} from './settings-view.mjs'
import {createAppClient} from '@moss/app-sdk/ui'
const $=id=>document.getElementById(id)
const root=$('buddy-app'),product=root.querySelector('.buddy-product')
let state=null,requestBusy=false,pollTimer=null,currentPage='pet',preferencesDirty=false,toolsLoaded=false
const client=window.mossApp?createAppClient(window.mossApp):null
const notice=(message='')=>{$('notice').textContent=message;$('notice').hidden=!message}
async function invoke(name,input={}){if(!client)throw new Error('请在 Moss 中打开 Buddy App');return client.actions.invoke(name,input,{timeoutMs:120000})}
function element(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el}
function messageBody(text){
 const fragment=document.createDocumentFragment();let start=0;
 for(const match of text.matchAll(/`([^`\n]+)`|\*\*([^*\n]+)\*\*/g)){
  fragment.append(document.createTextNode(text.slice(start,match.index)),element(match[1]?'code':'strong',match[1]||match[2]));start=match.index+match[0].length;
 }
 fragment.append(document.createTextNode(text.slice(start)));return fragment;
}
const systemTheme=matchMedia('(prefers-color-scheme: dark)')
let currentAppearance={themeMode:'system',cssThemeId:'grid-theme'}
function appearance(value={}){
 currentAppearance={...currentAppearance,...value};const html=document.documentElement
 const theme=currentAppearance.themeMode==='system'?(systemTheme.matches?'dark':'light'):currentAppearance.themeMode
 html.dataset.theme=theme;html.style.colorScheme=theme;html.dataset.backgroundStyle=currentAppearance.cssThemeId
 for(const [key,variable,min,max,unit] of [['chatFontSize','--b-chat-font-size',12,18,'px'],['chatLineHeight','--b-chat-line-height',1.3,2,''],['chatMessageSpacing','--b-chat-spacing',4,24,'px']]){
  const number=currentAppearance[key];if(typeof number==='number'&&Number.isFinite(number))html.style.setProperty(variable,`${Math.max(min,Math.min(max,number))}${unit}`)
 }
}
const systemThemeChanged=()=>{if(currentAppearance.themeMode==='system')appearance()}
systemTheme.addEventListener('change',systemThemeChanged);appearance()
window.addEventListener('beforeunload',()=>systemTheme.removeEventListener('change',systemThemeChanged),{once:true})
function render(next){
 if(!next||state&&next.revision<state.revision)return
 state=next;product.classList.toggle('hatched',Boolean(state.pet));if(!state.pet)return
 const pet=state.pet;$('birthday').textContent=`陪伴第 ${Math.max(1,Math.floor((Date.now()-pet.hatchedAt)/86400000)+1)} 天`;product.dataset.skin=pet.skin;$('display-name').textContent=pet.name;$('chat-input').placeholder=`跟${pet.name}说点什么…`
 const busy=requestBusy||state.pending.length>0
 $('pet-status').textContent=busy?'正在回复…':'';$('chat-shortcuts').hidden=state.messages.some(message=>message.role==='user');product.classList.toggle('b-thinking',busy)
 $('send').disabled=busy;$('stop').hidden=!state.pending.length
 const log=$('messages'),atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<55
 const messages=state.messages.slice(-200)
 if(log.dataset.fingerprint!==JSON.stringify(messages)){
  log.replaceChildren(...messages.map(message=>{const row=element('div',undefined,`b-message ${message.role==='user'?'user':'pet'}`);row.append(messageBody(message.text));if(message.role==='welcome')row.append(element('span',' · 见面问候','b-welcome-label'));return row}))
  log.dataset.fingerprint=JSON.stringify(messages);if(atBottom)log.scrollTop=log.scrollHeight
 }
 if(!preferencesDirty){
  $('edit-name').value=pet.name;$('edit-skin').value=pet.skin;$('personality').value=pet.personality;$('tone').value=state.preferences.tone
  $('permission-mode').value=state.preferences.permissionMode;$('tool-access').value=state.preferences.toolAccess;$('tool-selection').hidden=state.preferences.toolAccess!=='selected'
  $('config-enabled').checked=state.preferences.configEnabled;$('notifications-enabled').checked=state.preferences.notificationsEnabled
  $('responder').value=state.preferences.agentId?`agent:${state.preferences.agentId}`:state.preferences.assistantName?`assistant:${state.preferences.assistantName}`:'builtin'
 }
 $('chat-errors').replaceChildren(...state.errors.map(error=>{const row=element('div',error.error,'b-error');const button=element('button','重新发送','b-chip');button.type='button';button.onclick=()=>send(error.text,error.turnId?undefined:error.id);row.append(button);return row}))
 clearTimeout(pollTimer);if(state.pending.length)pollTimer=setTimeout(refresh,1500)
}
async function refresh(){try{render(await invoke('pet.get'))}catch(error){notice(error.message);if(state?.pending.length)pollTimer=setTimeout(refresh,5000)}}
async function send(text,requestId=crypto.randomUUID()){
 if(!text.trim()||requestBusy||state?.pending.length)return
 requestBusy=true;notice();$('send').disabled=true;$('pet-status').textContent='让我想一想…'
 try{const result=await invoke('chat.send',{text,requestId});$('chat-input').value='';requestBusy=false;render(result)}catch(error){notice(error.message);requestBusy=false;await refresh()}finally{requestBusy=false;if(state)render(state)}
}
$('hatch-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;notice();try{render(await invoke('pet.hatch',{name:$('pet-name').value,skin:$('hatch-skin').value}));product.classList.add('b-jump');$('chat-input').focus()}catch(error){notice(error.message)}finally{button.disabled=false}}
$('chat-form').onsubmit=event=>{event.preventDefault();void send($('chat-input').value)}
$('chat-input').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void send(event.target.value)}}
root.querySelectorAll('[data-prompt]').forEach(button=>button.onclick=()=>send(button.dataset.prompt))
$('stop').onclick=async()=>{try{render(await invoke('chat.stop'))}catch(error){notice(error.message)}}
$('preferences-form').oninput=()=>{preferencesDirty=true;$('tool-selection').hidden=$('tool-access').value!=='selected'}
$('preferences-form').onsubmit=async event=>{
 event.preventDefault();if(!state)return;const responder=$('responder').value
 try{const next=await invoke('pet.update',{revision:state.revision,name:$('edit-name').value,skin:$('edit-skin').value,personality:$('personality').value,preferences:{...(toolsLoaded?{tools:[...$('tool-picker').querySelectorAll('input:checked')].map(input=>input.value)}:{}),tone:$('tone').value,permissionMode:$('permission-mode').value,toolAccess:$('tool-access').value,configEnabled:$('config-enabled').checked,notificationsEnabled:$('notifications-enabled').checked,agentId:responder.startsWith('agent:')?responder.slice(6):null,assistantName:responder.startsWith('assistant:')?responder.slice(10):null}});preferencesDirty=false;render(next);notice()}catch(error){notice(error.message)}
}
$('pet-settings-toggle').onclick=()=>{$('pet-settings').open=!$('pet-settings').open}
$('pet-settings').ontoggle=async()=>{const open=$('pet-settings').open;product.classList.toggle('b-editing',open);$('pet-settings-toggle').textContent=open?'返回聊天':'伙伴设置';$('pet-settings-toggle').setAttribute('aria-expanded',String(open));if(!open)return;try{const result=await invoke('assistants.list');const picker=$('responder'),selected=picker.value;picker.replaceChildren(new Option('Buddy 内置助手','builtin'));for(const agent of result.agents)picker.add(new Option(agent.name||agent.id,`agent:${agent.id}`));for(const assistant of result.assistants)picker.add(new Option(assistant.label,`assistant:${assistant.id}`));if(preferencesDirty)picker.value=selected;render(state);if(!toolsLoaded){$('tool-picker').replaceChildren(...result.tools.map(tool=>{const row=element('label',undefined,'b-setting-check');const input=document.createElement('input');input.type='checkbox';input.value=tool.id;input.checked=state?.preferences.tools?.includes(tool.id);row.append(input,element('span',tool.name||tool.id));row.title=tool.description||'';return row}));toolsLoaded=true}}catch(error){notice(error.message)}}
async function notifications(){try{const result=await invoke('notifications.list');const items=result.notifications||[];if(product.classList.contains('b-mini')&&!state?.pending.length){const unread=items.filter(item=>!item.read).length;$('pet-status').textContent=unread?`有 ${unread} 条消息`:'在这儿，陪你一起。'}$('unread').textContent=items.some(item=>!item.read)?` · ${items.filter(item=>!item.read).length}`:'';$('notifications').replaceChildren(...(items.length?items.map(item=>{const row=element('article',undefined,'b-article');row.append(element('h3',item.title),element('p',item.message),element('small',`${item.source} · ${new Date(item.createdAt).toLocaleString()}`));if(!item.read){const button=element('button','标记已读','b-chip');button.onclick=async()=>{try{await invoke('notifications.read',{id:item.id});await notifications()}catch(error){notice(error.message)}};row.append(button)}return row}):[element('p','暂时没有重要消息。')]))}catch(error){notice(error.message)}}
async function help(){try{const result=await invoke('help_search',{query:$('help-query').value});$('articles').replaceChildren(...(result.articles.length?result.articles.map(item=>{const article=element('article',undefined,'b-article');article.append(element('h3',item.title),element('p',item.body),element('small',`${result.source} · ${item.id}`));return article}):[element('p','没有找到这项内容，可以换个关键词或和宠物聊聊。')]))}catch(error){notice(error.message)}}
$('help-form').onsubmit=event=>{event.preventDefault();void help()}
const settingsView=createSettingsView({invoke,notice,canWrite:()=>Boolean(state?.preferences.configEnabled),talk:prompt=>{document.querySelector('[data-page="pet"]').click();$('chat-input').value=prompt;$('chat-input').focus()}})
root.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>{currentPage=button.dataset.page;$('pet-settings').open=false;root.querySelectorAll('[data-page]').forEach(b=>b.setAttribute('aria-current',b===button?'page':'false'));for(const page of ['pet','notifications','help','configuration'])$(`page-${page}`).hidden=page!==currentPage;notice();if(currentPage==='notifications')void notifications();if(currentPage==='help')void help();if(currentPage==='configuration')void settingsView.load()})
if(client){
 client.app.getInfo().then(info=>appearance(info.appearance)).catch(error=>notice(error.message));client.events.on('appearance',appearance)
 client.events.on('buddy.changed',()=>{void refresh()})
 void refresh().then(()=>{if(state?.preferences.notificationsEnabled)void notifications()})
 const timer=setInterval(()=>{if(!document.hidden&&state?.pet&&state.preferences.notificationsEnabled)void notifications()},30000)
 window.addEventListener('beforeunload',()=>{clearTimeout(pollTimer);clearInterval(timer);client.dispose()},{once:true})
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh()})
}else notice('请从 Moss 的应用页面安装并打开 Buddy。')

function route(){
 const [page,query='']=location.hash.slice(1).split('?');const mini=page==='/companion'&&new URLSearchParams(query).get('expanded')!=='1';
 product.classList.toggle('b-mini',mini);document.documentElement.classList.toggle('buddy-mini',mini);
 if(page==='/companion')document.querySelector('[data-page="pet"]').click();
 if(page==='/preferences'){document.querySelector('[data-page="pet"]').click();$('pet-settings').open=true}
}
window.addEventListener('hashchange',route);route();
