import {describe,it,expect} from 'vitest'
import {emptySession,parseSession,validContext,sessionKey} from './session'
describe('unified assistant persistence',()=>{
 it('isolates courses and preserves unknown records',()=>{expect(sessionKey('a')).not.toBe(sessionKey('b'));const s=emptySession('a');expect(parseSession(JSON.stringify(s),'a')).toEqual(s);expect(()=>parseSession(JSON.stringify(s),'b')).toThrow();expect(()=>parseSession('{','a')).toThrow();expect(()=>parseSession(JSON.stringify({...s,schema:2}),'a')).toThrow()})
 it('rejects out of bounds context',()=>{const c={kind:'document',title:'课件',text:'片段',sourceId:'s',documentId:'hash',previewVersion:'v',page:1,regions:[{x:.1,y:.1,width:.2,height:.2}]};expect(validContext(c)).toBe(true);expect(validContext({...c,regions:[{x:.9,y:0,width:.2,height:1}]})).toBe(false)})
})
