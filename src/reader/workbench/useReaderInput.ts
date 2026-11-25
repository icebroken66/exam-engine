import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
export function isEditing(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input,textarea,select,[contenteditable=true],[role=textbox]')
}
export function useReaderInput({enabled,scroll,cancel,mode,go,page,pages,undo,redo,remove,selected,hasSelection}:{enabled:boolean;scroll:RefObject<HTMLDivElement|null>;cancel:()=>void;mode:string;go:(n:number)=>void;page:number;pages:number;undo:()=>void;redo:()=>void;remove:()=>void;selected:boolean;hasSelection:boolean}){
  const latest=useRef({cancel,mode,go,page,pages,undo,redo,remove,selected,hasSelection});latest.current={cancel,mode,go,page,pages,undo,redo,remove,selected,hasSelection}
  const [panning,setPanning]=useState(false)
  useEffect(()=>{
    const el=scroll.current;if(!enabled||!el)return
    let drag:{id:number;x:number;y:number;left:number;top:number}|null=null
    const stop=()=>{drag=null;setPanning(false)}
    const down=(e:PointerEvent)=>{if(e.button!==1||isEditing(e.target))return;e.preventDefault();e.stopPropagation();el.focus({preventScroll:true});window.dispatchEvent(new Event('reader:cancel-gesture'));drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:el.scrollLeft,top:el.scrollTop};el.setPointerCapture(e.pointerId);setPanning(true)}
    const move=(e:PointerEvent)=>{if(!drag||drag.id!==e.pointerId)return;e.preventDefault();el.scrollLeft=drag.left+drag.x-e.clientX;el.scrollTop=drag.top+drag.y-e.clientY}
    const up=(e:PointerEvent)=>{if(!drag||e.pointerId!==drag.id)return;stop();if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId)}
    const aux=(e:MouseEvent)=>{if(e.button===1)e.preventDefault()}
    const context=(e:MouseEvent)=>{if(isEditing(e.target))return;if(latest.current.mode!=='read'||latest.current.hasSelection||latest.current.selected||window.getSelection()?.toString()){e.preventDefault();latest.current.cancel()}}
    const key=(e:KeyboardEvent)=>{
      if(e.defaultPrevented||e.isComposing||isEditing(e.target)||e.altKey)return
      const target=e.target instanceof Element?e.target:null
      if(target?.closest('.wb-global-assistant,.app-unified-assistant,.course-tree,.wb-navigation,[role=dialog]'))return
      const s=latest.current
      if(e.key==='Escape'){stop();return}
      const modifier=e.ctrlKey||e.metaKey
      if(modifier&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?s.redo():s.undo();return}
      if(modifier&&e.key.toLowerCase()==='y'){e.preventDefault();s.redo();return}
      if(modifier&&(e.key==='PageDown'||e.key==='PageUp')){e.preventDefault();s.go(Math.min(s.pages,Math.max(1,s.page+(e.key==='PageDown'?1:-1))));return}
      if(modifier)return
      if((e.key==='Delete'||e.key==='Backspace')&&s.selected){e.preventDefault();s.remove();return}
      if(target?.closest('button,a,summary'))return
      const directions:Record<string,[number,number]>={ArrowDown:[0,64],ArrowUp:[0,-64],ArrowLeft:[-64,0],ArrowRight:[64,0],PageDown:[0,el.clientHeight*.85],PageUp:[0,-el.clientHeight*.85]}
      if(directions[e.key]){e.preventDefault();const[x,y]=directions[e.key];el.scrollBy({left:x,top:y,behavior:'instant'})}
      if(e.key==='Home'||e.key==='End'){e.preventDefault();el.scrollTo({top:e.key==='Home'?0:el.scrollHeight,behavior:'instant'})}
    }
    el.addEventListener('pointerdown',down,true);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',stop);el.addEventListener('lostpointercapture',stop);el.addEventListener('auxclick',aux);el.addEventListener('contextmenu',context);window.addEventListener('blur',stop);window.addEventListener('keydown',key)
    return()=>{el.removeEventListener('pointerdown',down,true);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',stop);el.removeEventListener('lostpointercapture',stop);el.removeEventListener('auxclick',aux);el.removeEventListener('contextmenu',context);window.removeEventListener('blur',stop);window.removeEventListener('keydown',key)}
  },[enabled,scroll])
  return panning
}
