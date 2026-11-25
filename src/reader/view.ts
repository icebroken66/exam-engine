import type { ReaderState } from './types'
export const MIN_ZOOM = .1
export const MAX_ZOOM = 4
export function validZoom(value: unknown): value is ReaderState['zoom'] {
  return value === 'fit' || value === 'page' || typeof value === 'number' && Number.isFinite(value) && value >= MIN_ZOOM && value <= MAX_ZOOM
}
export function viewScale(zoom: ReaderState['zoom'], page: {width:number;height:number}, area: {width:number;height:number}) {
  const width = Math.max(.01, (area.width - 48) / page.width)
  return zoom === 'fit' ? width : zoom === 'page' ? Math.min(width, Math.max(.01, (area.height - 48) / page.height)) : zoom
}
/** Keep the page coordinate beneath a viewport point fixed when changing scale. */
export function zoomScroll(oldScale:number, nextScale:number, page:{width:number;height:number}, area:{width:number;height:number}, scroll:{x:number;y:number}, focal:{x:number;y:number}) {
  const axis = (size:number, available:number, position:number, at:number) => {
    const oldOffset=Math.max(24,(available-size*oldScale)/2)
    const nextOffset=Math.max(24,(available-size*nextScale)/2)
    return Math.max(0, nextOffset+((position+at-oldOffset)/oldScale)*nextScale-at)
  }
  return {x:axis(page.width,area.width,scroll.x,focal.x),y:axis(page.height,area.height,scroll.y,focal.y)}
}
