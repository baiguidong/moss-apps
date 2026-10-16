import sharp from 'sharp'
import path from 'node:path'

const formats = ['jpeg', 'png', 'webp', 'avif', 'tiff']
const positions = ['centre','north','northeast','east','southeast','south','southwest','west','northwest']
const hex = value => /^#[a-f\d]{6}$/i.test(value)
export async function inspect(file) {
  const meta = await sharp(file, { limitInputPixels: 60_000_000 }).metadata()
  if (!formats.includes(meta.format)) throw new Error('支持 JPEG、PNG、WebP、AVIF 和 TIFF 图片')
  if ((meta.pages || 1) > 1) throw new Error('请先选择静态单帧图片')
  const swap = [5, 6, 7, 8].includes(meta.orientation)
  const previewPath = meta.format === 'tiff' ? file + '.preview.png' : undefined
  if (previewPath) await sharp(file, { limitInputPixels: 60_000_000 }).autoOrient().resize({ width: 1800, withoutEnlargement: true }).png().toFile(previewPath)
  return { kind: 'image', previewPath, metadata: { width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height, format: meta.format, hasAlpha: meta.hasAlpha, space: meta.space, density: meta.density, hasExif: !!meta.exif, hasIcc: !!meta.icc } }
}
export function validate(input, files) {
  if (!Array.isArray(input.fileIds) || !input.fileIds.length || input.fileIds.length > 50) throw new Error('请选择 1–50 张图片')
  const fileIds = [...new Set(input.fileIds)]
  for (const id of fileIds) if (!files.some(f => f.id === id && f.kind === 'image')) throw new Error('选择的图片不存在')
  const raw = input.options || {}, options = {}
  const numbers = { quality:[1,100,82,true], width:[0,8192,0,true], height:[0,8192,0,true], rotation:[-360,360,0], brightness:[0.1,3,1], saturation:[0,3,1], hue:[0,360,0], lightness:[-100,100,0], gamma:[1,3,1], blur:[0,20,0], sharpen:[0,10,0], median:[0,11,0,true], threshold:[0,255,128,true], border:[0,1024,0,true] }
  for (const [key,[min,max,fallback,integer]] of Object.entries(numbers)) {
    const value = Number(raw[key] ?? fallback)
    if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new Error(`${key} 应为 ${min}–${max}${integer ? ' 的整数' : ''}`)
    options[key] = value
  }
  if (options.median && (options.median < 3 || options.median % 2 !== 1)) throw new Error('中值降噪窗口应为 3、5、7、9 或 11')
  for (const [key,values,fallback] of [['format',['original',...formats],'webp'],['fit',['inside','cover','contain','fill','outside'],'inside'],['position',[...positions,'entropy','attention'],'centre'],['metadata',['strip','keep'],'strip']]) {
    options[key] = raw[key] ?? fallback
    if (!values.includes(options[key])) throw new Error(`不支持的 ${key}`)
  }
  for (const key of ['allowEnlargement','flip','flop','grayscale','negate','normalise','thresholdEnabled','transparentBackground']) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') throw new Error(`${key} 应为布尔值`)
    options[key] = raw[key] ?? false
  }
  options.background = raw.background ?? '#ffffff'; options.tint = raw.tint || ''
  if (!hex(options.background) || options.tint && !hex(options.tint)) throw new Error('颜色应为六位十六进制色值')
  if (['entropy','attention'].includes(options.position) && options.fit !== 'cover') options.position = 'centre'
  if (raw.crop) {
    const crop = Object.fromEntries(['left', 'top', 'width', 'height'].map(k => [k, Number(raw.crop[k])]))
    if (fileIds.length !== 1) throw new Error('裁剪时请选择单张图片')
    if (Object.values(crop).some(n => !Number.isInteger(n)) || crop.left < 0 || crop.top < 0 || crop.width < 1 || crop.height < 1) throw new Error('裁剪范围无效')
    const meta = files.find(f => f.id === fileIds[0]).metadata
    if (crop.left + crop.width > meta.width || crop.top + crop.height > meta.height) throw new Error('裁剪范围超出图片')
    options.crop = crop
  }
  if (raw.watermark) {
    const w = raw.watermark
    if (typeof w.text !== 'string' || !w.text.trim() || w.text.length > 120) throw new Error('水印应为 1–120 个字符')
    const fontSize = Number(w.fontSize ?? 32), opacity = Number(w.opacity ?? 0.5), margin = Number(w.margin ?? 16)
    if (!Number.isInteger(fontSize) || fontSize < 8 || fontSize > 256 || !Number.isFinite(opacity) || opacity < 0.05 || opacity > 1 || !Number.isInteger(margin) || margin < 0 || margin > 1000 || !hex(w.color || '#ffffff') || !positions.includes(w.position || 'southeast')) throw new Error('水印设置无效')
    options.watermark = { text:w.text.trim(), fontSize, opacity, margin, color:w.color || '#ffffff', position:w.position || 'southeast' }
  }
  const allowed = new Set([...Object.keys(options),'crop','watermark'])
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`不支持的参数：${key}`)
  return { fileIds, title: `处理 ${fileIds.length} 张图片`, options }
}
export function watermarkSvg(w, width, height) {
  const text = w.text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
  const margin = Math.min(w.margin, width / 3, height / 3), fontSize = Math.min(w.fontSize, height - margin * 2)
  const left = w.position.includes('west'), right = w.position.includes('east'), top = w.position.includes('north'), bottom = w.position.includes('south')
  const x = left ? margin : right ? width-margin : width/2, y = top ? margin+fontSize : bottom ? height-margin : (height+fontSize*0.7)/2
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${x}" y="${y}" text-anchor="${left?'start':right?'end':'middle'}" font-family="sans-serif" font-size="${fontSize}" fill="${w.color}" fill-opacity="${w.opacity}">${text}</text></svg>`)
}
export async function execute({ input, files, outputDir, signal, progress }) {
  const options = validate(input, files).options, result = []
  for (const [index, id] of input.fileIds.entries()) {
    signal.throwIfAborted()
    const file = files.find(f => f.id === id), format = options.format === 'original' ? file.metadata.format : options.format
    progress(index / input.fileIds.length * 100, `正在处理 ${file.name}`)
    const background = options.transparentBackground && format !== 'jpeg' ? {r:0,g:0,b:0,alpha:0} : options.background
    let pipeline = sharp(file.path, { limitInputPixels: 60_000_000 }).autoOrient()
    if (options.crop) {
      pipeline = pipeline.extract(options.crop)
      // Materialize the displayed crop before any requested rotation or mirroring.
      if (options.rotation || options.flip || options.flop) {
        if (options.metadata === 'keep') pipeline = pipeline.keepMetadata()
        pipeline = sharp(await pipeline.png().toBuffer(), {limitInputPixels:60_000_000})
      }
    }
    if (options.rotation) pipeline = pipeline.rotate(options.rotation, {background})
    if (options.flip) pipeline = pipeline.flip()
    if (options.flop) pipeline = pipeline.flop()
    if (options.width || options.height) pipeline = pipeline.resize({ width:options.width || undefined, height:options.height || undefined, fit:options.fit, position:options.position, background, withoutEnlargement:!options.allowEnlargement })
    if (options.border) pipeline = pipeline.extend({top:options.border,bottom:options.border,left:options.border,right:options.border,background})
    if (options.brightness !== 1 || options.saturation !== 1 || options.hue || options.lightness) pipeline = pipeline.modulate({brightness:options.brightness,saturation:options.saturation,hue:options.hue,lightness:options.lightness})
    if (options.gamma !== 1) pipeline = pipeline.gamma(options.gamma)
    if (options.normalise) pipeline = pipeline.normalise()
    if (options.grayscale) pipeline = pipeline.grayscale()
    if (options.negate) pipeline = pipeline.negate({alpha:false})
    if (options.tint) pipeline = pipeline.tint(options.tint)
    if (options.median) pipeline = pipeline.median(options.median)
    if (options.blur) pipeline = pipeline.blur(options.blur < 0.3 ? 0.3 : options.blur)
    if (options.sharpen) pipeline = pipeline.sharpen({sigma:options.sharpen})
    if (options.thresholdEnabled) pipeline = pipeline.threshold(options.threshold)
    if (options.metadata === 'keep') pipeline = pipeline.keepMetadata()
    if (options.watermark) {
      const {data,info} = await pipeline.png().toBuffer({resolveWithObject:true})
      signal.throwIfAborted()
      pipeline = sharp(data).composite([{input:watermarkSvg(options.watermark,info.width,info.height)}])
      if (options.metadata === 'keep') pipeline = pipeline.keepMetadata()
    }
    if (format === 'jpeg') pipeline = pipeline.flatten({ background:options.background })
    const name = `${path.parse(file.name).name}-${index + 1}.${format === 'jpeg' ? 'jpg' : format}`, output = path.join(outputDir, name)
    await pipeline.toFormat(format, { quality:options.quality, compressionLevel:9, ...(format === 'tiff' ? {compression:'lzw'} : {}) }).toFile(output)
    signal.throwIfAborted()
    const { metadata, previewPath } = await inspect(output)
    const transformed = !!(options.crop || options.rotation || options.flip || options.flop || options.border || options.width && options.height && options.fit !== 'inside')
    result.push({ name, path:output, previewPath, kind:'image', metadata:{...metadata,sourceId:id,inputSize:file.size,cropped:!!options.crop,transformed,settings:options} })
  }
  return { files:result, message:`已生成 ${result.length} 张图片` }
}
