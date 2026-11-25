import {describe,it,expect} from 'vitest'
import {inkHit,segmentDistance} from './eraser'
import type {Annotation} from './types'
const ink={kind:'ink',width:2,points:[{x:.1,y:.1},{x:.1,y:.8},{x:.8,y:.8}]} as Annotation
describe('whole stroke CSS eraser',()=>{
 it('tests polyline segments rather than the bounding box',()=>{
  expect(inkHit(ink,{x:.5,y:.5},{x:.5,y:.5},1000,600,8)).toBe(false)
  expect(inkHit(ink,{x:0,y:.5},{x:.9,y:.5},1000,600,8)).toBe(true)
 })
 it('keeps CSS radius independent of page scale and includes ink width',()=>{
  for(const w of [300,600,1200]){
   const item={...ink,points:[{x:.5,y:.1},{x:.5,y:.9}],width:8} as Annotation
   expect(inkHit(item,{x:.5+11/w,y:.5},{x:.5+11/w,y:.5},w,w*1.3,8)).toBe(true)
   expect(inkHit(item,{x:.5+13/w,y:.5},{x:.5+13/w,y:.5},w,w*1.3,8)).toBe(false)
  }
 })
 it('handles degenerate, crossing, endpoint and collinear paths',()=>{
  expect(segmentDistance({x:0,y:0},{x:0,y:0},{x:3,y:4},{x:3,y:4})).toBe(5)
  expect(segmentDistance({x:0,y:0},{x:10,y:0},{x:5,y:-5},{x:5,y:5})).toBe(0)
  expect(segmentDistance({x:0,y:0},{x:10,y:0},{x:5,y:0},{x:15,y:0})).toBe(0)
  expect(inkHit({kind:'highlight'} as Annotation,{x:0,y:0},{x:1,y:1},500,500,8)).toBe(false)
 })
})
