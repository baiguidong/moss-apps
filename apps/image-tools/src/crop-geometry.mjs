const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
export function clampCrop(rect, bounds) {
  const width = clamp(Math.round(rect.width), 1, bounds.width), height = clamp(Math.round(rect.height), 1, bounds.height)
  return {left:clamp(Math.round(rect.left),0,bounds.width-width),top:clamp(Math.round(rect.top),0,bounds.height-height),width,height}
}
export function ratioCrop(rect, bounds, ratio, dimension = 'width') {
  if (!ratio) return clampCrop(rect,bounds)
  const width = dimension === 'height' ? rect.height*ratio : rect.width
  const fit = Math.min(width,bounds.width,bounds.height*ratio)
  return clampCrop({...rect,width:fit,height:fit/ratio},bounds)
}
export function dragCrop(rect, start, point, mode, bounds, ratio = 0) {
  const p = {x:clamp(point.x,0,bounds.width),y:clamp(point.y,0,bounds.height)}
  if (mode === 'move') return clampCrop({...rect,left:rect.left+p.x-start.x,top:rect.top+p.y-start.y},bounds)
  if (mode === 'draw') {
    const sx = p.x >= start.x ? 1 : -1, sy = p.y >= start.y ? 1 : -1
    let width = Math.abs(p.x-start.x), height = Math.abs(p.y-start.y)
    if (ratio) {width=Math.min(Math.max(width,height*ratio),sx>0?bounds.width-start.x:start.x,(sy>0?bounds.height-start.y:start.y)*ratio);height=width/ratio}
    return clampCrop({left:sx>0?start.x:start.x-width,top:sy>0?start.y:start.y-height,width,height},bounds)
  }
  let left=rect.left,top=rect.top,right=left+rect.width,bottom=top+rect.height
  if(mode.includes('w'))left=clamp(p.x,0,right-1)
  if(mode.includes('e'))right=clamp(p.x,left+1,bounds.width)
  if(mode.includes('n'))top=clamp(p.y,0,bottom-1)
  if(mode.includes('s'))bottom=clamp(p.y,top+1,bounds.height)
  if (!ratio) return clampCrop({left,top,width:right-left,height:bottom-top},bounds)
  const horizontal = mode==='e'||mode==='w', vertical=mode==='n'||mode==='s'
  const anchorX=horizontal?(mode==='w'?rect.left+rect.width:rect.left):vertical?rect.left+rect.width/2:mode.includes('w')?rect.left+rect.width:rect.left
  const anchorY=vertical?(mode==='n'?rect.top+rect.height:rect.top):horizontal?rect.top+rect.height/2:mode.includes('n')?rect.top+rect.height:rect.top
  const maxW=vertical?2*Math.min(anchorX,bounds.width-anchorX):mode.includes('w')?anchorX:bounds.width-anchorX
  const maxH=horizontal?2*Math.min(anchorY,bounds.height-anchorY):mode.includes('n')?anchorY:bounds.height-anchorY
  const wanted=vertical?(bottom-top)*ratio:horizontal?right-left:Math.max(right-left,(bottom-top)*ratio)
  const width=Math.min(wanted,maxW,maxH*ratio),height=width/ratio
  return clampCrop({left:vertical?anchorX-width/2:mode.includes('w')?anchorX-width:anchorX,top:horizontal?anchorY-height/2:mode.includes('n')?anchorY-height:anchorY,width,height},bounds)
}
