import {describe,it,expect} from 'vitest'
import {viewScale,validZoom,zoomScroll} from './view'
describe('continuous view contract',()=>{
  it('accepts old presets and continuous zoom while rejecting corrupt values',()=>{for(const z of ['fit','page',.1,.5,1,1.37,2,4])expect(validZoom(z)).toBe(true);for(const z of [0,-1,4.01,NaN,Infinity,'1','other',null])expect(validZoom(z)).toBe(false)})
  it('fits landscape and portrait into available area including gutters',()=>{for(const p of [{width:800,height:600},{width:600,height:800}]){const s=viewScale('page',p,{width:1000,height:600});expect(p.width*s+48).toBeLessThanOrEqual(1000);expect(p.height*s+48).toBeLessThanOrEqual(600)}})
  it('preserves focal page coordinate when large pages zoom',()=>{expect(zoomScroll(1,2,{width:800,height:600},{width:500,height:400},{x:100,y:80},{x:250,y:200})).toEqual({x:426,y:336})})
})
