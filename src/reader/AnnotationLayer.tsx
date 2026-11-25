import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { anchor, clamp, pointAt, regionBetween, regionStyle } from './coordinates'
import type { Anchor, Annotation, DocumentInfo, Mode, Point } from './types'
import type { CSSProperties } from 'react'
import { inkHit } from './eraser'
import { RiDraggable, RiStickyNoteLine, RiSubtractLine, RiAddLine, RiDeleteBinLine } from '@remixicon/react'
const stamp = () => new Date().toISOString()
export function AnnotationLayer({ doc, page, mode, width, eraserRadius = 8, color = '#215cbd', annotations, selection, indication, hidden, selected, select, change, onSelection }: { doc: DocumentInfo; page: number; mode: Mode; width: number; eraserRadius?: number; color?: string; annotations: Annotation[]; selection: Anchor | null; indication: Anchor | null; hidden: boolean; selected: string | null; select: (id: string | null) => void; change: (next: Annotation[]) => void; onSelection: (a: Anchor | null) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const gesture = useRef<{ points: Point[]; id: number } | null>(null)
  const drag = useRef<{ id: string; start: Point; origin: Point; current: Point } | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [moving, setMoving] = useState<{ id: string; at: Point } | null>(null)
  const erase = useRef<{id:number;last:Point;removed:Set<string>;original:Annotation[]}|null>(null)
  const [erased,setErased]=useState<Set<string>>(new Set())
  const [cursor,setCursor]=useState<Point|null>(null)
  const root = useRef<HTMLDivElement>(null)
  const coord = (e: { clientX: number; clientY: number }) => pointAt(e.clientX, e.clientY, root.current!.getBoundingClientRect())
  const cancel = () => { gesture.current = null; drag.current = null; erase.current=null;setErased(new Set());setCursor(null); setPoints([]); setMoving(null) }
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) cancel() }
    window.addEventListener('resize',cancel);window.addEventListener('blur', cancel); window.addEventListener('keydown', key);window.addEventListener('reader:cancel-gesture',cancel)
    return () => { window.removeEventListener('resize',cancel);window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key);window.removeEventListener('reader:cancel-gesture',cancel) }
  }, [])
  useEffect(() => { cancel() }, [page, mode, hidden, doc.id, eraserRadius])
  useEffect(()=>{if(!root.current)return;const observer=new ResizeObserver(cancel);observer.observe(root.current);return()=>observer.disconnect()},[])
  function eraseAt(p:Point){const g=erase.current;if(!g||hidden)return;const bounds=root.current!.getBoundingClientRect();for(const item of g.original)if(item.anchor.page===page&&inkHit(item,g.last,p,bounds.width,bounds.height,eraserRadius))g.removed.add(item.id);g.last=p;setErased(new Set(g.removed));setCursor(p)}
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if(e.button===0&&mode==='erase'&&!hidden){e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const p=coord(e);erase.current={id:e.pointerId,last:p,removed:new Set(),original:annotations};select(null);eraseAt(p);return}
    if (e.button !== 0 || (mode !== 'region' && mode !== 'ink')) return
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); const p = coord(e); gesture.current = { points: [p], id: e.pointerId }; setPoints([p]); select(null)
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    if(mode==='erase'&&!hidden){const bounds=root.current!.getBoundingClientRect();if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom){cancel();return}const p=coord(e);setCursor(p);if(erase.current?.id===e.pointerId)eraseAt(p);return}
    const g = gesture.current; if (!g || g.id !== e.pointerId) return
    const bounds = root.current!.getBoundingClientRect()
    if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) { cancel(); return }
    const p = coord(e); g.points = mode === 'region' ? [g.points[0], p] : [...g.points, p]; setPoints(g.points)
  }
  function up(e: ReactPointerEvent<SVGSVGElement>) {
    if(erase.current?.id===e.pointerId){eraseAt(coord(e));const g=erase.current;const next=g.original.filter(a=>!g.removed.has(a.id));cancel();if(g.removed.size)change(next);return}
    const g = gesture.current; if (!g || g.id !== e.pointerId) return
    const ps = [...g.points, coord(e)]; cancel()
    const region = regionBetween(ps[0], ps[ps.length - 1])
    if (mode === 'region') { if (region.width > .002 && region.height > .002) onSelection(anchor(doc, page, [region])); return }
    if (ps.length > 1) {
      const xs = ps.map(p => p.x), ys = ps.map(p => p.y)
      const x = Math.min(...xs), y = Math.min(...ys)
      const a = anchor(doc, page, [{ x: Math.min(x, .9999), y: Math.min(y, .9999), width: Math.max(.0001, Math.max(...xs) - x), height: Math.max(.0001, Math.max(...ys) - y) }])
      change([...annotations, { id: crypto.randomUUID(), schema: 1, anchor: a, kind: 'ink', points: ps, width, color, updatedAt: stamp() }])
    }
  }
  const pageItems = annotations.filter(a => a.anchor.page === page)
  function remove(id: string) {
    change(annotations.filter(a => a.id !== id)); select(null)
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-reader-action=add-note]')?.focus())
  }
  return <div className="rl-annotations" ref={root}>
    <svg ref={svg} className={`rl-overlay rl-mode-${mode}`} viewBox="0 0 1000 1000" preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={cancel} onLostPointerCapture={cancel}>
      {!hidden && pageItems.filter(a => a.kind !== 'note'&&!erased.has(a.id)).map(a => <g key={a.id} data-annotation={a.id} className={selected === a.id ? 'rl-selected' : ''} onPointerDown={e => { if (mode === 'read') { e.stopPropagation(); select(a.id) } }}>
        {a.kind === 'ink' ? <polyline points={a.points.map(p => `${p.x * 1000},${p.y * 1000}`).join(' ')} fill="none" stroke={a.color} strokeWidth={a.width} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" className={mode === 'read' ? 'rl-hit-ink' : ''} /> : a.anchor.regions.map((r, i) => <rect key={i} x={r.x * 1000} y={r.y * 1000} width={r.width * 1000} height={r.height * 1000} fill={a.color} fillOpacity=".32" className={mode === 'read' ? 'rl-hit' : ''} />)}
      </g>)}
      {[{ a: selection, cls: 'rl-selection' }, { a: indication, cls: 'rl-indication' }].map(({ a, cls }) => a?.page === page && a.regions.map((r, i) => <rect key={`${cls}${i}`} className={cls} x={r.x * 1000} y={r.y * 1000} width={r.width * 1000} height={r.height * 1000} vectorEffect="non-scaling-stroke" />))}
      {points.length > 0 && (mode === 'ink' ? <polyline points={points.map(p => `${p.x * 1000},${p.y * 1000}`).join(' ')} fill="none" stroke={color} strokeWidth={width} vectorEffect="non-scaling-stroke" /> : (() => { const r = regionBetween(points[0], points[points.length - 1]); return <rect className="rl-selection" x={r.x * 1000} y={r.y * 1000} width={r.width * 1000} height={r.height * 1000} /> })())}
    </svg>
    {mode==='erase'&&!hidden&&cursor&&<span className="rl-eraser-cursor" aria-hidden style={{left:cursor.x*100+'%',top:cursor.y*100+'%',width:eraserRadius*2,height:eraserRadius*2}}/>}
    {!hidden && pageItems.filter(a => a.kind === 'note').map(a => {
      const at = moving?.id === a.id ? moving.at : a.anchor.regions[0]
      return <section key={a.id} data-annotation={a.id} className={`rl-note ${a.kind === 'note' && a.collapsed ? 'rl-note-collapsed' : ''} ${selected === a.id ? 'rl-note-selected' : ''}`} style={{ '--note-accent': a.kind === 'note' ? (a.color || '#ffe04a') : '#ffe04a', ...regionStyle({ ...at, width: .25, height: .15 }), left: `${clamp(at.x, 0, .99) * 100}%`, top: `${clamp(at.y, 0, .99) * 100}%` } as CSSProperties} onFocus={() => select(a.id)}>
        <button type="button" aria-label="拖动贴条" title="鼠标拖动，或方向键移动（Shift 加速）" className="rl-note-handle" onKeyDown={e => { const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; const d = delta[e.key]; if (!d) return; e.preventDefault(); const step = e.shiftKey ? .05 : .01; change(annotations.map(n => n.id === a.id ? { ...n, anchor: { ...n.anchor, regions: [{ ...n.anchor.regions[0], x: clamp(at.x + d[0] * step, 0, .75), y: clamp(at.y + d[1] * step, 0, .85) }] }, updatedAt: stamp() } : n)) }} onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: a.id, start: coord(e), origin: at, current: at }; select(a.id) }} onPointerMove={e => { const d = drag.current; if (!d || d.id !== a.id) return; const p = coord(e); d.current = { x: clamp(d.origin.x + p.x - d.start.x, 0, .75), y: clamp(d.origin.y + p.y - d.start.y, 0, .85) }; setMoving({ id: a.id, at: d.current }) }} onPointerUp={() => { const d = drag.current; if (!d) return; change(annotations.map(n => n.id === a.id ? { ...n, anchor: { ...n.anchor, regions: [{ ...n.anchor.regions[0], ...d.current }] }, updatedAt: stamp() } : n)); cancel() }} onPointerCancel={cancel} onLostPointerCapture={cancel}><RiDraggable aria-hidden/><span>笔记</span></button>
        <RiStickyNoteLine className="rl-note-symbol" aria-hidden/><button type="button" className="rl-note-toggle" aria-label={a.kind === 'note' && a.collapsed ? '展开贴条' : '收起贴条'} onClick={() => change(annotations.map(n => n.id === a.id && n.kind === 'note' ? { ...n, collapsed: !n.collapsed, updatedAt: stamp() } : n))}>{a.kind === 'note' && a.collapsed ? <RiAddLine aria-hidden/> : <RiSubtractLine aria-hidden/>}</button><textarea hidden={a.kind === 'note' && a.collapsed} aria-label="贴条内容" placeholder="写下你的理解或问题…" defaultValue={a.kind === 'note' ? a.text : ''} key={`${a.id}-${a.updatedAt}`} onBlur={e => { if (a.kind === 'note' && e.target.value !== a.text) change(annotations.map(n => n.id === a.id ? { ...a, text: e.target.value, updatedAt: stamp() } : n)) }} />
        <button type="button" aria-label="删除贴条" title="删除笔记，可撤销" onClick={() => remove(a.id)}><RiDeleteBinLine aria-hidden/></button>
      </section>
    })}
  </div>
}
