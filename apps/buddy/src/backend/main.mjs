import fs from 'node:fs/promises'
import { AppBackendClient } from '@moss/app-sdk'
import { createBuddyController } from './controller.mjs'

let controller
const backend=new AppBackendClient({async onInitialize(context){
  const [instructions,handbook]=await Promise.all([fs.readFile(new URL('../resources/assistant.md',import.meta.url),'utf8'),fs.readFile(new URL('../resources/handbook.json',import.meta.url),'utf8')])
  controller=await createBuddyController({dataDir:context.dataDir,host:(protocol,method,input)=>backend.host.request(protocol,method,input),emit:(name,data)=>backend.emit(name,data),instructions,handbook:JSON.parse(handbook),handbookVersion:context.version})
}})
for(const name of ['pet.get','pet.import-legacy','pet.hatch','pet.update','chat.send','chat.stop','assistants.list','settings_read','settings_apply','settings_undo','help_search','notifications.list','notifications.read'])backend.registerAction(name,async input=>{if(!controller)throw new Error('Buddy 正在初始化');return controller.actions[name](input||{})})
// ACK before reading the turn: Host can be publishing this event inside turn.start,
// while the controller's send transaction is still holding its serial queue.
for(const event of ['turn.completed','turn.failed','turn.review_requested'])backend.agent.on(event,data=>{if(controller)void controller.onTurn(data.turnId).catch(()=>{});return {handled:true}})
for(const event of ['binding.changed','turn.accepted'])backend.agent.on(event,()=>({handled:true}))
backend.start()
