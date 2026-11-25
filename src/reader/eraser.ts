import type { Annotation, Point } from './types'
const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
function pointDistance(p: Point, a: Point, b: Point) {
  const dx=b.x-a.x,dy=b.y-a.y,n=dx*dx+dy*dy
  const t=n ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/n)) : 0
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)
}
export function segmentDistance(a: Point,b: Point,c: Point,d: Point) {
  if (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) return 0
  return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b))
}
/** Eraser radius and ink width are CSS pixels; coordinates remain normalized. */
export function inkHit(item: Annotation, from: Point, to: Point, width: number, height: number, radius: number) {
  if(item.kind!=='ink'||!item.points.length)return false
  const css=(p:Point)=>({x:p.x*width,y:p.y*height}),a=css(from),b=css(to)
  for(let n=0;n<item.points.length;n++)if(segmentDistance(a,b,css(item.points[n]),css(item.points[Math.max(0,n-1)]))<=radius+item.width/2)return true
  return false
}
