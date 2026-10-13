const $=id=>document.getElementById(id)
const names={desktop:'Moss 桌面',agent:'Agent 与项目',session:'会话',apps:'应用',mcp:'工具服务',assistants:'助手',preferences:'终端与通用偏好'}
const scopes={user:'所有新会话的默认设置',project:'这个项目（共享）',local:'这个项目（仅自己）'}
const values={light:'浅色',dark:'深色',system:'跟随系统',auto:'自动',adaptive:'自动调整',enabled:'开启',disabled:'关闭',default:'标准',vim:'Vim 快捷键',emacs:'普通快捷键',bypassPermissions:'全部权限',acceptEdits:'自动批准文件编辑',dontAsk:'只执行已授权操作',plan:'仅规划',low:'低',medium:'中',high:'高',max:'最高',expanded:'展开',collapsed:'收起',merged:'合并',chinese:'中文',english:'英文',local:'本机',remote:'远端'}
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el}
function getValue(object,key){return key.split('.').reduce((value,part)=>value?.[part],object)}
function display(value){if(value?.redacted)return value.configured?'已设置（内容隐藏）':'未设置';if(value===true)return '已开启';if(value===false)return '已关闭';if(value===null||value===undefined||value==='')return '使用默认值';if(Array.isArray(value))return value.length?`已设置 ${value.length} 项`:'未单独设置';if(typeof value==='object')return '已配置';return values[value]||String(value)}
export function createSettingsView({invoke,notice,talk,canWrite}){
 let domains=[],group='全部',search='',receipt=null,generation=0
 const selections=new Map(),snapshots=new Map()
 const selection=domain=>{if(!selections.has(domain.id))selections.set(domain.id,{scope:domain.scopes[0],target:domain.scopes.includes('user')?'':domain.targets[0]?.id||''});return selections.get(domain.id)}
 const context=domain=>{const selected=selection(domain);return {domain:domain.id,scope:selected.scope,...(selected.target?{target:selected.target}:{})}}
 const key=domain=>JSON.stringify(context(domain))
 async function read(domain){
  const target=context(domain),id=JSON.stringify(target)
  if(!target.target&&!domain.scopes.includes('user')){snapshots.set(id,{empty:true});return}
  try{
   const [result,catalog]=await Promise.all([invoke('settings_read',{operation:'read',...target}),invoke('settings_read',{operation:'catalog',...target})])
   snapshots.set(id,{...result,fields:catalog.domains[0]?.fields||domain.fields})
  }catch(error){snapshots.set(id,{error:error.message})}
 }
 async function change(domain,field,value,button){
  if(!canWrite()){notice('先在伙伴设置中开启“允许修改 Moss 设置”。');return}
  const target=context(domain),snapshot=snapshots.get(key(domain));if(!snapshot?.revision)return
  button.disabled=true;notice()
  try{
   receipt=await invoke('settings_apply',{...target,revision:snapshot.revision,requestId:crypto.randomUUID(),changes:[{path:field.key,value}]})
   $('settings-result').textContent=`${field.label}：${display(value)}。${receipt.message||''}`;$('undo-config').hidden=false
   await read(domain);render()
  }catch(error){await read(domain);render();notice(`${error.message}。已刷新当前设置。`)}finally{button.disabled=false}
 }
 function fieldRow(domain,field,snapshot){
  const row=node('article',undefined,'b-config-row'),info=node('div',undefined,'b-config-info')
  info.append(node('h3',field.label||'扩展设置'),node('p',field.description||'向伙伴描述你想做的调整。'));row.append(info)
  const value=getValue(snapshot?.effective||snapshot?.values,field.key),hasValue=snapshot&&!snapshot.error&&!snapshot.empty
  const current=node('span',hasValue?display(value):'尚未读取','b-config-current');info.append(current)
  const editable=hasValue&&snapshot.revision&&!field.sensitive&&domain.writable&&canWrite()
  const schema=field.schema||{},options=schema.enum||schema.anyOf?.find(item=>item.enum)?.enum
  if(editable&&schema.type==='boolean'){
   const button=node('button',value?'关闭':'开启','b-chip');button.type='button';button.setAttribute('role','switch');button.setAttribute('aria-checked',String(Boolean(value)));button.setAttribute('aria-label',field.label);button.onclick=()=>change(domain,field,!value,button);row.append(button)
  }else if(editable&&options){
   const picker=node('select');picker.setAttribute('aria-label',field.label);picker.append(...options.map(option=>new Option(display(option),option)));picker.value=String(value??schema.default??'');picker.onchange=()=>change(domain,field,picker.value,picker);row.append(picker)
  }else{
   const button=node('button','和伙伴调整','b-chip');button.type='button';button.onclick=()=>{const target=selection(domain),label=domain.targets.find(t=>t.id===target.target)?.label;talk(`帮我调整${label?`「${label}」的`:''}${field.label}。${scopes[target.scope]||''}`)};row.append(button)
  }
  return row
 }
 function render(){
  const groups=['全部',...new Set(domains.flatMap(domain=>domain.fields.filter(f=>!f.sensitive).map(f=>f.group||'其他设置')))]
  $('settings-groups').replaceChildren(...groups.map(name=>{const b=node('button',name,'b-chip');b.type='button';b.setAttribute('aria-pressed',String(group===name));b.onclick=()=>{group=name;render()};return b}))
  const sections=[]
  for(const domain of domains){
   const snapshot=snapshots.get(key(domain)),fields=snapshot?.fields||domain.fields
   const matching=fields.filter(field=>!field.sensitive&&(group==='全部'||field.group===group)&&(!search||`${field.label} ${field.description} ${field.key}`.toLowerCase().includes(search)))
   const common=matching.filter(f=>f.common||search),extra=matching.filter(f=>!f.common&&!search)
   if(!matching.length)continue
   const section=node('section',undefined,'b-config-section'),head=node('div',undefined,'b-config-heading');head.append(node('h3',names[domain.id]||domain.title))
   if(domain.scopes.length>1){const picker=node('select');picker.setAttribute('aria-label',`${names[domain.id]}生效范围`);picker.append(...domain.scopes.map(scope=>new Option(scopes[scope]||scope,scope)));picker.value=selection(domain).scope;picker.onchange=async()=>{selection(domain).scope=picker.value;await read(domain);render()};head.append(picker)}
   if(domain.targets.length){const picker=node('select');picker.setAttribute('aria-label',`选择${names[domain.id]}`);if(domain.scopes.includes('user'))picker.add(new Option('本机默认设置',''));picker.append(...domain.targets.map(target=>new Option(target.label,target.id)));picker.value=selection(domain).target;picker.onchange=async()=>{selection(domain).target=picker.value;await read(domain);render()};head.append(picker)}
   section.append(head)
   if(snapshot?.empty)section.append(node('p','暂时没有可管理的对象。添加后会自动出现在这里。','b-setting-note'))
   else if(snapshot?.error)section.append(node('p',snapshot.error,'b-setting-note'))
   else section.append(...common.map(field=>fieldRow(domain,field,snapshot)))
   if(extra.length){const advanced=node('details',undefined,'b-config-advanced');advanced.append(node('summary',`更多设置（${extra.length} 项）`));for(const field of extra){const row=fieldRow(domain,field,snapshot);const detail=node('details',undefined,'b-technical');detail.append(node('summary','查看技术标识'),node('code',field.key));row.firstChild.append(detail);advanced.append(row)}section.append(advanced)}
   sections.push(section)
  }
  $('settings-list').replaceChildren(...(sections.length?sections:[node('p','没有找到这项设置，可以直接告诉伙伴你想完成什么。')]))
 }
 $('settings-search').oninput=event=>{search=event.target.value.trim().toLowerCase();render()}
 $('refresh-config').onclick=()=>void load()
 $('undo-config').onclick=async()=>{if(!receipt||!canWrite())return;try{const result=await invoke('settings_undo',{receiptId:receipt.receiptId,requestId:crypto.randomUUID()});receipt=null;$('undo-config').hidden=true;$('settings-result').textContent=result.message||'已撤销上次修改。';await load()}catch(error){notice(error.message)}}
 $('settings-ask').onsubmit=event=>{event.preventDefault();const input=$('settings-request');if(input.value.trim())talk(input.value.trim());input.value=''}
 async function load(){const current=++generation;try{const result=await invoke('settings_read',{operation:'catalog'});if(current!==generation)return;domains=result.domains;render();await Promise.all(domains.map(read));if(current===generation)render()}catch(error){notice(error.message)}}
 return {load}
}
