import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import {inspect,validate,execute,watermarkSvg} from '../src/backend/engine.mjs'
import {dragCrop,ratioCrop} from '../src/crop-geometry.mjs'

test('mouse crop geometry respects edges, handles, fixed ratios and moves',()=>{
 const bounds={width:960,height:640},r={left:100,top:80,width:400,height:300},start={x:130,y:110}
 assert.deepEqual(dragCrop(r,start,{x:1000,y:1000},'move',bounds),{left:560,top:340,width:400,height:300})
 assert.deepEqual(dragCrop(r,start,{x:700,y:500},'se',bounds),{left:100,top:80,width:600,height:420})
 assert.deepEqual(dragCrop(r,start,{x:10,y:20},'nw',bounds),{left:10,top:20,width:490,height:360})
 for(const mode of ['n','s','e','w','ne','nw','se','sw','draw']){
  const output=dragCrop(r,start,{x:900,y:630},mode,bounds,16/9)
  assert(output.left>=0&&output.top>=0&&output.width>0&&output.height>0)
  assert(output.left+output.width<=960&&output.top+output.height<=640)
  assert(Math.abs(output.width-output.height*16/9)<2,JSON.stringify({mode,output}))
 }
 assert.deepEqual(ratioCrop({left:0,top:0,width:960,height:640},bounds,1),{left:0,top:0,width:640,height:640})
})

test('sharp performs orientation-aware crops, rotation, padding, effects, metadata and escaped watermarks',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-image-operations-'))
 try{
  const file=path.join(root,'颜色.png'),pixels=Buffer.alloc(120*80*3)
  for(let y=0;y<80;y++)for(let x=0;x<120;x++){const i=(y*120+x)*3;pixels[i]=x<60?220:20;pixels[i+1]=y<40?60:180;pixels[i+2]=50}
  await sharp(pixels,{raw:{width:120,height:80,channels:3}}).png().withExif({IFD0:{Artist:'Moss fixture'}}).toFile(file)
  const input={id:'input',name:path.basename(file),path:file,size:(await fs.stat(file)).size,...await inspect(file)}
  const run=async(options)=>{const outputDir=await fs.mkdtemp(path.join(root,'result-'));const result=await execute({input:validate({fileIds:['input'],options},[input]),files:[input],outputDir,signal:new AbortController().signal,progress(){}});return result.files[0]}
  const crop=await run({format:'png',crop:{left:10,top:10,width:60,height:40},rotation:90})
  assert.equal(crop.metadata.width,40);assert.equal(crop.metadata.height,60)
  const flipped=await run({format:'png',flop:true});const pixel=await sharp(flipped.path).raw().toBuffer();assert.equal(pixel[0],20)
  const filled=await run({format:'png',width:100,height:100,fit:'contain',background:'#102030',border:5})
  assert.equal(filled.metadata.width,110);assert.equal(filled.metadata.height,110);assert.deepEqual([...await sharp(filled.path).removeAlpha().raw().toBuffer()].slice(0,3),[16,32,48])
  const gray=await run({format:'png',grayscale:true});const rgb=await sharp(gray.path).toColourspace('srgb').raw().toBuffer();assert.equal(rgb[0],rgb[1]);assert.equal(rgb[1],rgb[2])
  const bw=await run({format:'png',thresholdEnabled:true,threshold:100});assert([...await sharp(bw.path).removeAlpha().raw().toBuffer()].every(n=>n===0||n===255))
  const effects=await run({format:'webp',brightness:1.2,saturation:0.7,hue:20,lightness:3,gamma:1.3,normalise:true,median:3,blur:0.5,sharpen:1.2,tint:'#aabbcc'});assert.equal(effects.metadata.width,120)
  const stripped=await run({format:'png'}),kept=await run({format:'png',metadata:'keep'});assert(!stripped.metadata.hasExif);assert(kept.metadata.hasExif)
  const watermark={text:'Moss <& " 测试',fontSize:16,opacity:1,color:'#ffffff',position:'centre',margin:0}
  const marked=await run({format:'png',watermark});assert.notDeepEqual(await sharp(marked.path).raw().toBuffer(),await sharp(stripped.path).raw().toBuffer())
  assert.match(watermarkSvg(watermark,120,80).toString(),/Moss &lt;&amp; &quot;/)
  const tiff=await run({format:'tiff'});assert(tiff.previewPath);assert.equal((await sharp(tiff.previewPath).metadata()).format,'png')
  assert.throws(()=>validate({fileIds:['input'],options:{median:4}},[input]),/中值/)
  assert.throws(()=>validate({fileIds:['input'],options:{watermark:{text:'x',color:'<script>'}}},[input]),/水印/)
  const oriented=path.join(root,'oriented.jpg');await sharp(file).jpeg().withMetadata({orientation:6}).toFile(oriented)
  const original={...input,path:oriented,...await inspect(oriented)}
  const result=await execute({input:validate({fileIds:['input'],options:{format:'png',crop:{left:5,top:70,width:30,height:40},rotation:90}},[original]),files:[original],outputDir:root,signal:new AbortController().signal,progress(){}})
  assert.deepEqual([result.files[0].metadata.width,result.files[0].metadata.height],[40,30])
  const normalized=await sharp(oriented).autoOrient().png().toBuffer()
  const expected=await sharp(await sharp(normalized).extract({left:5,top:70,width:30,height:40}).png().toBuffer()).rotate(90).raw().toBuffer()
  assert.deepEqual(await sharp(result.files[0].path).raw().toBuffer(),expected,'crop uses displayed EXIF-corrected coordinates before rotation')
 }finally{await fs.rm(root,{recursive:true,force:true})}
})
