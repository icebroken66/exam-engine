import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { AnnotationLayer } from './AnnotationLayer'
import { PdfPage } from './PdfPage'
import { Button } from './boardui/button'
import { anchor, anchorError, clamp, pointAt, regionBetween } from './coordinates'
import { openPdf } from './pdf'
import { exportJson, readSnapshot, saveSnapshot, storageKey } from './storage'
import { initialReader } from './types'
import type { Anchor, Annotation, DocumentInfo, Mode, ReaderState, Snapshot } from './types'
import { NotesNavigation } from './workbench/NotesNavigation'
import { ExampleExplanation } from './workbench/ExampleExplanation'
import { ReaderToolbar, ViewControls } from './workbench/ReaderToolbar'
import { MAX_ZOOM, MIN_ZOOM, viewScale, zoomScroll } from './view'
import { isEditing, useReaderInput } from './workbench/useReaderInput'
import { AnnotationColors } from './workbench/AnnotationColors'
import type { ReaderStorage } from './courseStorage'
import { attachAssistant } from '../assistant/session'
import { LegacyDraft } from '../assistant/LegacyDraft'
import {CAPTURE,CANCEL_CAPTURE,READ_CAPTURE,captureState,cancelCapture,offerCandidate} from '../assistant/workspace'
type Session = { pdf: PDFDocumentProxy; info: DocumentInfo; annotations: Annotation[]; reader: ReaderState; blocked: boolean; raw: unknown }
type SaveState = '待保存' | '保存中' | '已保存' | '保存失败'
const LAST_KEY = 'fe-v01:last-document'
export function ReaderLab({ workbench = false, layout = 'a', globalAssistant, courseDocument }: { workbench?: boolean; layout?: 'a' | 'b'; globalAssistant?: { unified?:boolean; open: boolean; onOpenChange: (open: boolean) => void; host: HTMLElement | null; onDocumentChange: (loaded: boolean) => void }; courseDocument?: {file:File;storage:ReaderStorage;reload?:()=>void;courseId?:string;sourceId?:string} }) {
  const storageRef=useRef(courseDocument?.storage);storageRef.current=courseDocument?.storage
  const courseOpened=useRef<File|null>(null)
  const [navigationOpen, setNavigationOpen] = useState(true)
  const [penColor, setPenColor] = useState('#215cbd')
  const [highlightColor,setHighlightColor]=useState('#ffe04a')
  const [noteColor,setNoteColor]=useState('#ffe04a')
  const [shortcutHelp,setShortcutHelp]=useState(false)
  const [storageDetails, setStorageDetails] = useState(false)
  const dev = !workbench || new URLSearchParams(location.search).get('dev') === '1'
  const [session, setSession] = useState<Session | null>(null)
  const live = useRef(session); live.current = session
  const [phase, setPhase] = useState<'empty' | 'loading' | 'ready' | 'error'>('empty')
  const [message, setMessage] = useState('')
  const saveError=useRef('')
  const [saveState, setSaveState] = useState<SaveState>('已保存')
  const [mode, setMode] = useState<Mode>('read')
  const [capturing,setCapturing]=useState(false)
  const [captureSelection,setCaptureSelection]=useState<Anchor|null>(null)
  const captureReturn=useRef<{mode:Mode;selected:string|null}|null>(null)
  const [eraserRadius,setEraserRadius]=useState(8)
  const [penWidth, setPenWidth] = useState(2)
  const [hidden, setHidden] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [hasText, setHasText] = useState(true)
  const [rendered, setRendered] = useState(false)
  const [areaWidth, setAreaWidth] = useState(600)
  const [areaHeight, setAreaHeight] = useState(600)
  const [focusMode, setFocusMode] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const focusReturn = useRef<{ navigation:boolean; assistant:boolean; zoom:ReaderState['zoom']; scroll:{x:number;y:number} } | null>(null)
  const wheelZoom = useRef<(event:WheelEvent)=>void>(()=>{})
  const [pageInput, setPageInput] = useState('1')
  const [failure, setFailure] = useState(false)
  const failRef = useRef(failure); failRef.current = failure
  const dirty = useRef(false)
  const revision = useRef(0)
  const pendingSnapshot=useRef<{revision:number;snapshot:Snapshot}|null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const writing = useRef(false)
  const loadId = useRef(0)
  const history = useRef<{ undo: Annotation[][]; redo: Annotation[][] }>({ undo: [], redo: [] })
  const [historyTick, setHistoryTick] = useState(0)
  const returnState = useRef<ReaderState | null>(null)
  const citationJump=useRef<(target:Anchor)=>void>(()=>{})
  const [indication, setIndication] = useState<Anchor | null>(null)
  const [canReturn, setCanReturn] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const pageElement = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const askButton = useRef<HTMLButtonElement>(null)
  const assistantOrigin = useRef<'global' | 'selection'>('global')
  const draftInput = useRef<HTMLTextAreaElement>(null)
  const enterPageEnd=useRef(false)
  const wheelGate=useRef({time:-10000,last:0,edge:0,total:0})
  const pendingScroll = useRef<{ x: number; y: number } | null>(null)
  const [lastName] = useState(() => { try { return localStorage.getItem(LAST_KEY) || '' } catch { return '' } })
  const scheduleSave = useRef<() => void>(() => {})
  const persist = useCallback(async () => {
    clearTimeout(timer.current)
    const s = live.current
    if (!s || s.blocked || !dirty.current || writing.current) return
    const version = revision.current
    const key = storageKey(s.info)
    writing.current = true; setSaveState('保存中')
    const snapshot: Snapshot = pendingSnapshot.current?.revision===version ? pendingSnapshot.current.snapshot : { schema: 1, document: s.info, annotations: s.annotations, reader: s.reader, savedAt: new Date().toISOString() }
    pendingSnapshot.current={revision:version,snapshot}
    try {
      if(storageRef.current)await storageRef.current.save(snapshot,failRef.current)
      else await saveSnapshot(snapshot, failRef.current)
      const resolvedError=saveError.current;saveError.current='';setMessage(current=>current===resolvedError?'':current)
      if (live.current && storageKey(live.current.info) === key && revision.current === version) { dirty.current = false; setSaveState('已保存') }
      else if (live.current && storageKey(live.current.info) === key) { setSaveState('待保存'); scheduleSave.current() }
    } catch (e) { if (live.current && storageKey(live.current.info) === key) { setSaveState('保存失败'); saveError.current=`未保存：${String(e)}。内存内容保留，可重试或导出 JSON。`;setMessage(saveError.current) } }
    finally { writing.current = false }
  }, [])
  scheduleSave.current = () => { clearTimeout(timer.current); timer.current = setTimeout(() => void persist(), 350) }
  const update = useCallback((fn: (s: Session) => Session) => {
    if (!live.current) return
    const next = fn(live.current); live.current = next; setSession(next); dirty.current = true; revision.current++
    setSaveState(next.blocked ? '保存失败' : '待保存'); if (!next.blocked) scheduleSave.current()
  }, [])
  const readerUpdate = useCallback((patch: Partial<ReaderState>) => update(s => ({ ...s, reader: { ...s.reader, ...patch } })), [update])
  const changeAnnotations = (next: Annotation[]) => {
    if(captureReturn.current)return
    if (!live.current) return
    history.current.undo.push(live.current.annotations); history.current.redo = []; setHistoryTick(n => n + 1)
    update(s => ({ ...s, annotations: next }))
  }
  function undo(redo = false) {
    if(captureReturn.current)return
    window.dispatchEvent(new Event('reader:cancel-gesture'))
    const s = live.current; if (!s) return
    const from = redo ? history.current.redo : history.current.undo, to = redo ? history.current.undo : history.current.redo
    const next = from.pop(); if (!next) return
    to.push(s.annotations); update(v => ({ ...v, annotations: next })); setHistoryTick(historyTick + 1); setSelected(null)
  }
  useEffect(() => {
    const commitNote=()=>{if(document.activeElement instanceof HTMLTextAreaElement&&document.activeElement.closest('.rl-note'))document.activeElement.blur()}
    const before = (e: BeforeUnloadEvent) => { commitNote();if (dirty.current || writing.current) { e.preventDefault(); e.returnValue = '' } }
    const guard=(event:Event)=>{commitNote();window.dispatchEvent(new Event('reader:cancel-gesture'));if(dirty.current||writing.current){(event as CustomEvent).detail.blocked=true;setMessage('当前内容尚未保存，已保留阅读器。请等待保存，或重试／导出后处理，再切换。')}}
    window.addEventListener('reader:before-navigate',guard)
    window.addEventListener('beforeunload', before)
    return () => { window.removeEventListener('reader:before-navigate',guard);window.removeEventListener('beforeunload', before); clearTimeout(timer.current); void live.current?.pdf.loadingTask.destroy() }
  }, [])
  useEffect(() => {
    if (!scroll.current) return
    const observer = new ResizeObserver(entries => { setAreaWidth(entries[0].contentRect.width); setAreaHeight(entries[0].contentRect.height) })
    observer.observe(scroll.current); return () => observer.disconnect()
  }, [phase])
  useEffect(() => {
    if (!workbench || !scroll.current) return
    const el=scroll.current,handler=(event:WheelEvent)=>wheelZoom.current(event)
    el.addEventListener('wheel',handler,{passive:false})
    return ()=>el.removeEventListener('wheel',handler)
  },[workbench,phase])
  const pageReady = useCallback((text: boolean, error?: string) => { setHasText(text); setRendered(!error); if (error) setMessage(`页面渲染失败，请重新打开：${error}`) }, [])
  useEffect(()=>{if(courseDocument&&courseOpened.current!==courseDocument.file){courseOpened.current=courseDocument.file;void open(courseDocument.file)}},[courseDocument])
  const r = session ? capturing ? {...session.reader,selection:captureSelection} : session.reader : undefined
  useEffect(()=>{
    if(!courseDocument?.courseId||phase!=='ready')return
    const begin=()=>{const state=captureState();if(!state||state.courseId!==courseDocument.courseId)return;if(!captureReturn.current)captureReturn.current={mode,selected};window.dispatchEvent(new Event('reader:cancel-gesture'));setCapturing(true);setCaptureSelection(null);setSelected(null);setMode(state.kind);requestAnimationFrame(()=>scroll.current?.focus({preventScroll:true}))}
    const cancel=()=>{const previous=captureReturn.current;if(!previous)return;captureReturn.current=null;setCapturing(false);setCaptureSelection(null);setMode(previous.mode);setSelected(previous.selected);window.getSelection()?.removeAllRanges()}
    window.addEventListener(CAPTURE,begin);window.addEventListener(CANCEL_CAPTURE,cancel);if(!captureReturn.current)begin()
    return()=>{window.removeEventListener(CAPTURE,begin);window.removeEventListener(CANCEL_CAPTURE,cancel)}
  },[courseDocument?.courseId,phase,mode,selected])
  useEffect(()=>{const read=(event:Event)=>{if((event as CustomEvent).detail?.courseId!==courseDocument?.courseId||!r?.selection||!session||!courseDocument?.sourceId)return;offerCandidate({courseId:courseDocument.courseId!,title:session.info.name,binding:{role:'document_excerpt',source_id:courseDocument.sourceId,source_sha256:session.info.id,preview_version:session.info.previewVersion,page:r.selection.page,regions:r.selection.regions,precision:r.selection.precision,text:r.selection.text||''}})};window.addEventListener(READ_CAPTURE,read);return()=>window.removeEventListener(READ_CAPTURE,read)},[courseDocument,r?.selection,session])
  useEffect(() => { globalAssistant?.onDocumentChange(phase === 'ready') }, [phase, globalAssistant?.onDocumentChange])
  useEffect(() => { if (session && globalAssistant && !courseDocument?.courseId && session.reader.panelOpen !== globalAssistant.open) readerUpdate({ panelOpen: globalAssistant.open }) }, [globalAssistant?.open, session, readerUpdate])
  const pageInfo = session && session.info.pages[session.reader.page - 1]
  const scale = r && pageInfo ? viewScale(r.zoom,pageInfo,{width:areaWidth,height:areaHeight}) : 1
  useLayoutEffect(() => { setRendered(false) }, [scale, session?.reader.page, session?.pdf])
  useEffect(() => {
    if (!session || !rendered) return
    const pos = pendingScroll.current
    if (pos && scroll.current) { scroll.current.scrollTo(pos.x * scale, enterPageEnd.current ? scroll.current.scrollHeight : pos.y * scale); enterPageEnd.current=false; pendingScroll.current = null }
  }, [session?.reader.page, session?.reader.zoom, scale, rendered, session])
  async function open(file?: File) {
    if (!file) return
    if (dirty.current || writing.current) { setMessage('当前内容尚未保存，请先重试保存；也可导出 JSON 后刷新，再打开其他文件。'); return }
    const request = ++loadId.current
    setPhase('loading'); setMessage(''); setRendered(false)
    let opened: Awaited<ReturnType<typeof openPdf>> | null = null
    try {
      opened = await openPdf(file)
      const saved = storageRef.current ? await storageRef.current.read(opened.info) : await readSnapshot(opened.info).catch(e => ({ snapshot: null, raw: null, error: `无法读取本机数据，已暂停自动保存：${String(e)}` }))
      if (request !== loadId.current) { await opened.pdf.loadingTask.destroy(); return }
      const old = live.current
      const next: Session = { ...opened, annotations: saved.snapshot?.annotations || [], reader: saved.snapshot?.reader || {...initialReader(),zoom:workbench?'page':'fit'}, blocked: !!saved.error, raw: saved.raw }
      live.current = next; pendingSnapshot.current=null; setSession(next); setPhase('ready'); setSaveState(saved.error ? '保存失败' : '已保存'); dirty.current = false
      setPageInput(String(next.reader.page)); pendingScroll.current = next.reader.scroll; history.current = { undo: [], redo: [] }; setHistoryTick(n => n + 1); setMode('read'); setSelected(null); setIndication(null); returnState.current = null; setCanReturn(false); setHidden(false)
      if (saved.error) setMessage(saved.error)
      if (globalAssistant && !courseDocument?.courseId) globalAssistant.onOpenChange(globalAssistant.open || next.reader.panelOpen)
      if(!courseDocument)try { localStorage.setItem(LAST_KEY, file.name) } catch { /* IndexedDB remains authoritative. */ }
      if (old) await old.pdf.loadingTask.destroy()
    } catch (e) { await opened?.pdf.loadingTask.destroy(); if (request === loadId.current) { setPhase('error'); setMessage(`打开失败：${String(e)}`) } }
  }
  function go(page: number) {
    window.dispatchEvent(new Event('reader:cancel-gesture'))
    if (!session) return
    if (!Number.isInteger(page) || page < 1 || page > session.info.pages.length) { setMessage(`请输入 1 至 ${session.info.pages.length} 的整数页码。`); return }
    setMessage(''); setPageInput(String(page)); pendingScroll.current = { x: 0, y: 0 }; setIndication(null); setSelected(null); readerUpdate({ page, scroll: { x: 0, y: 0 } })
  }
  function zoom(value: ReaderState['zoom'], focal?: {x:number;y:number}) {
    window.dispatchEvent(new Event('reader:cancel-gesture'))
    if (!r || !pageInfo) return
    const target=typeof value==='number'?Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,value)):value
    const nextScale=viewScale(target,pageInfo,{width:areaWidth,height:areaHeight})
    if(workbench&&scroll.current){const pos=zoomScroll(scale,nextScale,pageInfo,{width:areaWidth,height:areaHeight},{x:scroll.current.scrollLeft,y:scroll.current.scrollTop},focal||{x:areaWidth/2,y:areaHeight/2});pendingScroll.current={x:pos.x/nextScale,y:pos.y/nextScale}}
    else pendingScroll.current = { x: (scroll.current?.scrollLeft || 0) / scale, y: (scroll.current?.scrollTop || 0) / scale }
    readerUpdate({zoom:target})
  }
  wheelZoom.current=event=>{
    const el=scroll.current;if(!el||!r||isEditing(event.target))return
    if(event.ctrlKey||event.metaKey){event.preventDefault();const bounds=el.getBoundingClientRect();zoom(scale*Math.exp(-event.deltaY*.002),{x:event.clientX-bounds.left,y:event.clientY-bounds.top});return}
    if(event.shiftKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||!event.deltaY||event.buttons||!rendered)return
    const direction=event.deltaY>0?1:-1,max=el.scrollHeight-el.clientHeight
    const atEdge=direction>0?el.scrollTop>=max-2:el.scrollTop<=2
    const gate=wheelGate.current,now=performance.now()
    if(!atEdge){gate.total=0;gate.edge=0;return}
    if((direction<0&&r.page===1)||(direction>0&&r.page===session!.info.pages.length))return
    event.preventDefault()
    if(now-gate.time<500)return
    if(gate.edge!==direction||now-gate.last>1000)gate.total=0
    gate.edge=direction;gate.total+=Math.abs(event.deltaY)*(event.deltaMode===1?16:event.deltaMode===2?el.clientHeight:1);gate.last=now
    if(gate.total<60)return
    gate.time=now;gate.total=0;enterPageEnd.current=direction<0;go(r.page+direction)
  }

  function enterFocus(){if(!live.current||focusReturn.current)return;focusReturn.current={navigation:navigationOpen,assistant:globalAssistant?.open??live.current.reader.panelOpen,zoom:live.current.reader.zoom,scroll:{x:(scroll.current?.scrollLeft||0)/scale,y:(scroll.current?.scrollTop||0)/scale}};setNavigationOpen(false);setFocusMode(true);setMode('read');globalAssistant?.onOpenChange(false);readerUpdate({zoom:'page',panelOpen:false})}
  function leaveFocus(){const old=focusReturn.current;if(!old)return;focusReturn.current=null;setFocusMode(false);setNavigationOpen(old.navigation);globalAssistant?.onOpenChange(old.assistant);pendingScroll.current=old.scroll;readerUpdate({zoom:old.zoom,panelOpen:old.assistant})}
  async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else{const root=pageElement.current?.closest('.wb-review');if(!(root instanceof HTMLElement)||!root.requestFullscreen)throw new Error('浏览器不支持全屏，请使用专注阅读');await root.requestFullscreen();enterFocus()}}catch(error){setMessage('无法进入全屏：'+String(error)+'。可使用专注阅读。')}}
  useEffect(()=>{const changed=()=>{setFullscreen(!!document.fullscreenElement);if(!document.fullscreenElement)leaveFocus()};document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed)},[globalAssistant?.onOpenChange,readerUpdate])
  function selection(a: Anchor | null) { if(captureReturn.current){setCaptureSelection(a);return}readerUpdate({ selection: a, ...(!globalAssistant?.unified && live.current?.reader.panelOpen ? { context: a } : {}) }) }
  function textSelection() {
    if (mode !== 'text' || !session || !pageElement.current) return
    const selectedText = window.getSelection()
    if (!selectedText?.rangeCount || selectedText.isCollapsed || !pageElement.current.contains(selectedText.anchorNode) || !pageElement.current.contains(selectedText.focusNode)) return
    const range = selectedText.getRangeAt(0), bounds = pageElement.current.getBoundingClientRect()
    const regions = Array.from(range.getClientRects()).filter(b => b.width > 1 && b.height > 1 && b.bottom > bounds.top && b.top < bounds.bottom).map(b => regionBetween(pointAt(b.left, b.top, bounds), pointAt(b.right, b.bottom, bounds))).filter(b => b.width > 0 && b.height > 0)
    if (regions.length) selection(anchor(session.info, session.reader.page, regions, selectedText.toString()))
  }
  function add(kind: 'highlight' | 'note') {
    if(captureReturn.current)return
    if (!session) return
    const source = r?.selection?.page === r?.page ? r?.selection : null
    if (kind === 'highlight' && !source) return
    const a = source || anchor(session.info, session.reader.page, [{ x: .15, y: .15, width: .25, height: .15 }])
    const id = crypto.randomUUID()
    const base = { id, schema: 1 as const, anchor: kind === 'note' ? { ...a, regions: [{ ...a.regions[0], x: clamp(a.regions[0].x, 0, .75), y: clamp(a.regions[0].y, 0, .85), width: .25, height: .15 }] } : a, updatedAt: new Date().toISOString() }
    changeAnnotations([...session.annotations, kind === 'highlight' ? { ...base, kind, color: highlightColor } : { ...base, kind, text: '', color:noteColor }]); setSelected(id); setHidden(false); setMode('read')
    if (kind === 'note') requestAnimationFrame(() => pageElement.current?.querySelector<HTMLTextAreaElement>(`[data-annotation="${id}"] textarea`)?.focus())
  }
  function ask() { if(captureReturn.current&&courseDocument?.courseId){window.dispatchEvent(new CustomEvent(READ_CAPTURE,{detail:{courseId:courseDocument.courseId}}));return} if(globalAssistant?.unified&&r?.selection&&session&&courseDocument){const params=new URLSearchParams(location.search);attachAssistant(courseDocument.courseId||params.get('course')!,{kind:'document',title:session.info.name,text:r.selection.text||'',sourceId:courseDocument.sourceId||params.get('source')!,documentId:session.info.id,previewVersion:session.info.previewVersion,page:r.selection.page,regions:r.selection.regions});return} assistantOrigin.current = 'selection'; globalAssistant?.onOpenChange(true); readerUpdate({ panelOpen: true, context: r?.selection || null }); requestAnimationFrame(() => draftInput.current?.focus()) }
  function restoreAssistantFocus() { if (globalAssistant && assistantOrigin.current === 'global') document.querySelector<HTMLButtonElement>('[data-global-assistant-trigger]')?.focus(); else askButton.current?.focus(); assistantOrigin.current = 'global' }
  function closePanel() { globalAssistant?.onOpenChange(false); readerUpdate({ panelOpen: false }); requestAnimationFrame(restoreAssistantFocus) }
  function cancelTool(){if(captureReturn.current){cancelCapture();return}window.dispatchEvent(new Event('reader:cancel-gesture'));window.getSelection()?.removeAllRanges();setMode('read');setSelected(null);if(live.current?.reader.selection)readerUpdate({selection:null});setMessage('');requestAnimationFrame(()=>scroll.current?.focus({preventScroll:true}))}
  function removeSelected(){if(live.current&&selected){changeAnnotations(live.current.annotations.filter(a=>a.id!==selected));setSelected(null)}}
  const panning=useReaderInput({enabled:workbench&&phase==='ready',scroll,cancel:cancelTool,mode,go,page:r?.page||1,pages:session?.info.pages.length||1,undo:()=>undo(),redo:()=>undo(true),remove:removeSelected,selected:!!selected,hasSelection:!!r?.selection})
  const selectedAnnotation=session?.annotations.find(a=>a.id===selected)
  function colorSelected(color:string){if(!live.current||!selected)return;changeAnnotations(live.current.annotations.map(a=>a.id===selected?{...a,color,updatedAt:new Date().toISOString()}:a))}
  useEffect(() => {
    if (!workbench) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if(event.isComposing)return
      if(event.defaultPrevented)return
      if(captureReturn.current){event.preventDefault();cancelCapture();return}
      const opened=document.querySelector<HTMLDetailsElement>('.wb-ribbon details[open]');if(opened){opened.open=false;opened.querySelector<HTMLElement>('summary')?.focus();return}
      if(shortcutHelp){setShortcutHelp(false);return}
      if(isEditing(event.target)){(event.target as HTMLElement).blur();return}
      if(focusReturn.current){if(document.fullscreenElement)void document.exitFullscreen();else leaveFocus();return}
      if(mode!=='read'||live.current?.reader.selection||selected){event.preventDefault();cancelTool();return}
      if (live.current?.reader.panelOpen) { globalAssistant?.onOpenChange(false); readerUpdate({ panelOpen: false }); requestAnimationFrame(restoreAssistantFocus) }
      else { setMode('read'); readerUpdate({ selection: null }) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [workbench, readerUpdate, globalAssistant?.onOpenChange,mode,selected,shortcutHelp])
  function locateNote(a: Annotation) {
    if (!session || anchorError(a.anchor, session.info)) return
    const size = session.info.pages[a.anchor.page - 1], region = a.anchor.regions[0]
    pendingScroll.current = { x: Math.max(0, region.x * size.width - 30), y: Math.max(0, region.y * size.height - 30) }
    setPageInput(String(a.anchor.page)); setSelected(a.id); setHidden(false); setMode('read'); readerUpdate({ page: a.anchor.page })
  }
  function jump(target: Anchor) {
    if (!session) return
    const error = anchorError(target, session.info); if (error) { setMessage(error); return }
    returnState.current = { ...session.reader, scroll: { x: (scroll.current?.scrollLeft || 0) / scale, y: (scroll.current?.scrollTop || 0) / scale } }
    setCanReturn(true); setIndication(target); setPageInput(String(target.page))
    const size = session.info.pages[target.page - 1], region = target.regions[0]
    pendingScroll.current = region ? { x: Math.max(0, region.x * size.width - 30), y: Math.max(0, region.y * size.height - 30) } : { x: 0, y: 0 }
    readerUpdate({ page: target.page }); setMessage(target.precision === 'page' ? '固定引用夹具：仅有可靠页码，已执行页级定位。' : '固定引用夹具：蓝色虚线为临时指示，不保存为个人高亮。')
  }
  citationJump.current=jump
  useEffect(()=>{
    const locate=(event?:Event)=>{
      if(!session||!courseDocument?.sourceId)return
      const params=new URLSearchParams(location.hash.split('?')[1]||'')
      const action=event instanceof CustomEvent?event.detail:undefined
      if((action?.source_id||params.get('source'))!==courseDocument.sourceId||(!action&&!params.has('citation_page')))return
      const target:Anchor={documentId:action?.source_sha256||params.get('citation_sha')||'',previewVersion:action?.preview_version||params.get('citation_version')||'',page:Number(action?.page||params.get('citation_page')),space:'normalized-top-left',regions:[],precision:'page'}
      if(anchorError(target,session.info)){setMessage('引用版本或页码已失效，未跳转。');return}
      citationJump.current(target);setMessage('已定位到引用页；仅页级精度，未创建个人批注。')
    }
    locate();window.addEventListener('hashchange',locate);window.addEventListener('assistant:citation-location',locate)
    return()=>{window.removeEventListener('hashchange',locate);window.removeEventListener('assistant:citation-location',locate)}
  },[phase,session?.info.id,courseDocument?.sourceId])
  function back() { const previous = returnState.current; if (!previous) return; pendingScroll.current = previous.scroll; setPageInput(String(previous.page)); readerUpdate(previous); setIndication(null); setCanReturn(false); returnState.current = null }
  useEffect(()=>{const restore=()=>back();window.addEventListener('assistant:citation-back',restore);return()=>window.removeEventListener('assistant:citation-back',restore)},[])
  const fixed = session ? anchor(session.info, session.info.pages.length > 1 && r?.page === 1 ? 2 : 1, [{ x: .12, y: .2, width: .58, height: .15 }]) : null
  const assistantPanel = !globalAssistant?.unified && session && r && r.panelOpen ? (<aside className="rl-context" aria-label="上下文预览"><div className="rl-panel-header"><strong>{workbench ? 'AI 学习助手' : '提问上下文'}</strong><Button variant="secondary" size="small" onClick={closePanel}>关闭面板</Button></div><div className="rl-panel-body"><p className="rl-badge">未连接模型 · 无真实请求</p>{r.context ? <><p>资料：{session.info.name}<br/>版本：{r.context.documentId.slice(0, 12)}…<br/>预览：{r.context.previewVersion}<br/>页码：{r.context.page}</p><blockquote>{r.context.text || '区域选择；未执行 OCR，不提供识别文字。'}</blockquote><details open={!workbench}><summary>选区详情与版本</summary><p>左上原点、归一化坐标</p><pre>{JSON.stringify(r.context.regions, null, 2)}</pre></details><Button variant="secondary" size="small" onClick={() => readerUpdate({ context: null })}>移除上下文</Button></> : <p>无关联选区，可选字或框选后替换上下文。</p>}<hr/>{workbench && <ExampleExplanation page={fixed?.page || 1} jump={() => fixed && jump(fixed)} />}<div hidden={workbench && !dev}><p>以下为固定引用夹具，与问题内容无关。</p><Button variant="secondary" size="small" onClick={() => fixed && jump(fixed)}>固定引用：定位第 {fixed?.page} 页</Button><details><summary>异常引用验证夹具</summary><Button variant="secondary" size="small" onClick={() => fixed && jump({ ...fixed, page: 99999 })}>无效页号引用</Button><Button variant="secondary" size="small" onClick={() => fixed && jump({ ...fixed, previewVersion: 'wrong-version' })}>版本不匹配引用</Button><Button variant="secondary" size="small" onClick={() => fixed && jump({ ...fixed, regions: [] })}>区域缺失引用</Button><Button variant="secondary" size="small" onClick={() => fixed && jump({ ...fixed, precision: 'page', regions: [] })}>仅页码引用</Button></details></div></div><label className="rl-draft">{courseDocument?'问题草稿（随课程笔记保存）':'问题草稿（仅本机暂存）'}<textarea ref={draftInput} aria-label="问题草稿" value={r.draft} onChange={e => readerUpdate({ draft: e.target.value })} placeholder="描述你想理解的问题，不会自动发送。" /></label></aside>) : null
  return <div className={workbench ? 'reader-lab wb-shell wb-tools-'+layout : 'reader-lab'} data-navigation={navigationOpen} data-focus={focusMode} onScrollCapture={event => { if (workbench && event.target instanceof HTMLElement) event.target.dataset.scrolled = String(event.target.scrollTop > 0) }}>
    {capturing&&<div className="aw-capture-banner" role="status"><strong>临时上下文取材</strong><span>不会创建高亮或贴条；区域未执行OCR</span><Button size="small" variant="secondary" disabled={!r?.selection} onClick={ask}>预览本次取材</Button><Button size="small" variant="ghost" onClick={()=>cancelCapture()}>取消并恢复原工具</Button></div>}<header className="rl-header"><div><strong>{workbench ? '资料阅读' : '课件阅读与批注'}</strong><span className="rl-badge">{workbench ? '工作台 · 设计评审' : 'FE-V01 · 电脑技术验证'}</span></div><a href="/">返回原应用</a></header>
    <div className="rl-filebar"><label hidden={!!courseDocument} className="rl-file-label">打开本地 PDF<input ref={fileInput} aria-label="打开本地 PDF" type="file" accept="application/pdf,.pdf" onChange={e => { void open(e.target.files?.[0]); e.target.value = '' }} /></label><span title={session?.info.name} className="rl-filename">{session?.info.name || '未打开文件'}</span>{session && <span role="status" data-testid="save-status" className={saveState === '保存失败' ? 'rl-error' : ''}>{saveState}</span>}<span className={courseDocument?"rl-local rl-course-storage":"rl-local"}>{courseDocument ? '服务端保存 · 不修改原件' : workbench ? '仅保存在此浏览器' : '本机验证数据 · 不连接模型 · 不写回原件'}</span></div>
    {message && <div role="alert" className="rl-message">{message}<Button variant="secondary" size="small" onClick={() => setMessage('')} aria-label="关闭提示">×</Button></div>}
    {phase !== 'ready' ? <main className="rl-empty"><h1>{phase === 'loading' ? '正在读取课件…' : phase === 'error' ? '课件读取失败' : '打开课件，开始验证'}</h1><p>支持 PDF 原版面只读预览；PPTX 需要人工导出 PDF。暂不支持旋转、OCR、自动转换。</p>{!courseDocument && lastName && <p>上次文件：{lastName}。刷新后请重新选择原文件，按 SHA-256 匹配恢复。</p>}<Button variant="secondary" size="small" onClick={() => courseDocument?void open(courseDocument.file):fileInput.current?.click()}>{courseDocument?'重新打开课程PDF':'选择／重新打开 PDF'}</Button></main> : session && r && pageInfo && <>
      {workbench ? <div className="aw-tools-wrap" inert={capturing}><ReaderToolbar eraserRadius={eraserRadius} setEraserRadius={setEraserRadius} mode={mode} setMode={m => { setMode(m); window.getSelection()?.removeAllRanges() }} navigation={navigationOpen} toggleNavigation={() => {window.dispatchEvent(new Event('reader:cancel-gesture'));setNavigationOpen(!navigationOpen)}} penColor={penColor} setPenColor={setPenColor} penWidth={penWidth} setPenWidth={setPenWidth} canUndo={!!history.current.undo.length} canRedo={!!history.current.redo.length} undo={() => undo()} redo={() => undo(true)} canDelete={!!selected} remove={() => { changeAnnotations(session.annotations.filter(a => a.id !== selected)); setSelected(null) }} hidden={hidden} toggleHidden={() => {window.dispatchEvent(new Event('reader:cancel-gesture'));setHidden(!hidden)}} hasSelection={!!r.selection && r.selection.page === r.page} highlight={() => add('highlight')} note={() => add('note')} focus={focusMode} toggleFocus={() => focusMode ? leaveFocus() : enterFocus()} fullscreen={fullscreen} toggleFullscreen={() => void toggleFullscreen()} cancel={cancelTool} help={() => setShortcutHelp(!shortcutHelp)} colors={<AnnotationColors selectedKind={selectedAnnotation?.kind} selectedColor={selectedAnnotation?.color} changeSelected={colorSelected} ink={penColor} highlight={highlightColor} note={noteColor} changeDefault={(kind,color)=>{if(kind === 'ink')setPenColor(color);else if(kind === 'highlight')setHighlightColor(color);else setNoteColor(color)}} />} /></div> : (      <nav className="rl-toolbar" aria-label="阅读与批注工具">{workbench && <Button variant="ghost" size="small" aria-pressed={navigationOpen} onClick={() => setNavigationOpen(!navigationOpen)}>{navigationOpen ? '收起导航' : '展开导航'}</Button>}<Button variant="secondary" size="small" onClick={() => go(r.page - 1)} disabled={r.page <= 1}>上一页</Button><form onSubmit={e => { e.preventDefault(); go(Number(pageInput)) }}><input aria-label="跳转页码" value={pageInput} onChange={e => setPageInput(e.target.value)} size={3} /><span> / {session.info.pages.length}</span><Button variant="secondary" size="small" type="submit">跳转</Button></form><Button variant="secondary" size="small" onClick={() => go(r.page + 1)} disabled={r.page >= session.info.pages.length}>下一页</Button><select aria-label="缩放" value={r.zoom} onChange={e => zoom(e.target.value === 'fit' || e.target.value === 'page' ? e.target.value : Number(e.target.value))}><option value="fit">适应宽度</option>{r.zoom === 'page' && <option value="page">适应整页</option>}{typeof r.zoom === 'number' && ![.5,1,2].includes(r.zoom) && <option value={r.zoom}>{Math.round(r.zoom*100)}%</option>}<option value="0.5">50%</option><option value="1">100%</option><option value="2">200%</option></select>
        <div className="rl-modes" role="group" aria-label="当前模式">{(['read', 'text', 'region', 'ink', 'erase'] as Mode[]).map((m, i) => <Button variant="secondary" size="small" key={m} aria-pressed={mode === m} onClick={() => { setMode(m); window.getSelection()?.removeAllRanges() }}>{['阅读', '选字', '框选', '笔刷', '整笔橡皮擦'][i]}</Button>)}</div>{workbench && <select aria-label="新笔迹颜色" value={penColor} onChange={e => setPenColor(e.target.value)} title="仅影响之后绘制的笔迹"><option value="#215cbd">蓝笔</option><option value="#b73d35">红笔</option><option value="#287359">绿笔</option></select>}<select aria-label="笔宽" value={penWidth} onChange={e => setPenWidth(Number(e.target.value))}>{[1, 2, 4, 8].map(w => <option key={w} value={w}>{w} px</option>)}</select>
        <Button variant="secondary" size="small" onClick={() => undo()} disabled={!history.current.undo.length}>撤销</Button><Button variant="secondary" size="small" onClick={() => undo(true)} disabled={!history.current.redo.length}>重做</Button><Button variant="secondary" size="small" onClick={() => { changeAnnotations(session.annotations.filter(a => a.id !== selected)); setSelected(null) }} disabled={!selected}>删除选中</Button><Button variant="secondary" size="small" aria-pressed={hidden} onClick={() => setHidden(!hidden)}>{hidden ? '显示批注' : '隐藏批注'}</Button>
      </nav>)}
      <div className="rl-selectionbar"><span>{!hasText ? '本页没有可用文字层，请使用框选。' : mode === 'text' ? '选字模式：鼠标拖选，Shift + 方向键可扩展文字选择。' : `当前：${{ read: '阅读', region: '框选', ink: '笔刷', erase: '整笔橡皮擦 · 松开提交整次擦除', text: '选字' }[mode]}`}{r.selection && ` · 选区第 ${r.selection.page} 页`}</span><Button variant="secondary" size="small" disabled={!r.selection} onClick={() => workbench ? cancelTool() : selection(null)}>取消选区</Button>{!workbench && <Button variant="secondary" size="small" disabled={!r.selection || r.selection.page !== r.page} onClick={() => add('highlight')}>高亮选区</Button>}{!workbench && <Button variant="secondary" size="small" data-reader-action="add-note" onClick={() => add('note')}>添加贴条</Button>}<Button variant="secondary" size="small" ref={askButton} disabled={workbench && !r.selection} onClick={ask}>{workbench ? '向助手提问' : '问 AI／上下文'}</Button>{canReturn && <Button variant="secondary" size="small" onClick={back}>返回原位置</Button>}</div>
      {workbench && shortcutHelp && <div className="wb-shortcuts" role="dialog" aria-label="阅读快捷键"><strong>阅读快捷键</strong><button onClick={()=>setShortcutHelp(false)} aria-label="关闭快捷键">×</button><dl><dt>Esc / 右键</dt><dd>取消选区与工具，回到阅读；不清空助手上下文</dd><dt>方向键 / PageUp · PageDown</dt><dd>滚动阅读区域</dd><dt>Ctrl + PageUp · PageDown</dt><dd>上一页 / 下一页</dd><dt>Home / End</dt><dd>当前页顶部 / 底部</dd><dt>中键按住拖动</dt><dd>平移，松开或失焦结束</dd><dt>Ctrl + Z / Ctrl + Shift + Z</dt><dd>撤销 / 重做；Delete删除选中批注</dd></dl><small>文字输入、中文组合输入和表单控件优先，不抢占编辑快捷键。</small></div>}<main className={`rl-workspace ${r.panelOpen && !globalAssistant ? 'rl-panel-open' : ''} ${workbench && !navigationOpen ? 'wb-nav-closed' : ''}`}>
        {workbench ? (navigationOpen && <NotesNavigation annotations={session.annotations} locate={locateNote} close={() => setNavigationOpen(false)}><aside className="rl-thumbnails" aria-label="页面缩略图">{session.info.pages.map((p, i) => <Button variant="secondary" size="small" key={i} aria-label={`打开第 ${i + 1} 页`} aria-current={r.page === i + 1 ? 'page' : undefined} onClick={() => go(i + 1)}><PdfPage pdf={session.pdf} page={i + 1} scale={108 / p.width} thumbnail /><span>{i + 1}</span></Button>)}</aside></NotesNavigation>) : (<aside className="rl-thumbnails" aria-label="页面缩略图">{session.info.pages.map((p, i) => <Button variant="secondary" size="small" key={i} aria-label={`打开第 ${i + 1} 页`} aria-current={r.page === i + 1 ? 'page' : undefined} onClick={() => go(i + 1)}><PdfPage pdf={session.pdf} page={i + 1} scale={108 / p.width} thumbnail /><span>{i + 1}</span></Button>)}</aside>)}
        <div className={panning ? 'rl-scroll wb-panning' : 'rl-scroll'} ref={scroll} onScroll={() => { if (pendingScroll.current || !rendered) return; const el = scroll.current; if (el) readerUpdate({ scroll: { x: el.scrollLeft / scale, y: el.scrollTop / scale } }) }} tabIndex={0} aria-label="课件阅读区域">
          <div className="rl-page-wrap" style={{ width: Math.max(pageInfo.width * scale + 48, areaWidth), minHeight: Math.max(pageInfo.height * scale + 48, areaHeight) }}><div ref={pageElement} className={`rl-page rl-page-${mode}`} data-testid="reader-page" data-page={r.page} data-ready={rendered} data-document={session.info.id} style={{ width: pageInfo.width * scale, height: pageInfo.height * scale }} onMouseUp={textSelection} onKeyUp={textSelection}>
            <PdfPage pdf={session.pdf} page={r.page} scale={scale} onReady={pageReady} />
            <AnnotationLayer doc={session.info} page={r.page} mode={mode} eraserRadius={eraserRadius} width={penWidth} color={penColor} annotations={session.annotations} selection={r.selection} indication={indication} hidden={hidden} selected={selected} select={setSelected} change={changeAnnotations} onSelection={selection} />
          </div></div>
        </div>
        {assistantPanel && (globalAssistant?.host ? createPortal(assistantPanel, globalAssistant.host) : assistantPanel)}      </main>
      {workbench && <ViewControls page={r.page} pages={session.info.pages.length} go={go} zoom={r.zoom} scale={scale} onZoom={zoom} />}{workbench && storageDetails && <div className="wb-storage-info">{courseDocument?'课程模式：笔记与阅读状态保存到当前服务端数据库。收到成功回执才显示已保存；网络失败可重试或导出JSON。多窗口冲突先导出再重新载入服务器版本。本机旧笔记不会自动上传。':'笔记与问题草稿仅保存在此浏览器，未上传服务器。清理存储会丢失本机数据；刷新后重新选择相同 PDF 恢复。可导出 JSON 备份。PPTX 需人工转换为 PDF。'}</div>}<footer className="rl-footer">{globalAssistant?.unified&&<LegacyDraft value={r.draft} onChange={draft=>readerUpdate({draft})} courseId={courseDocument?.courseId||new URLSearchParams(location.search).get('course')!} context={{kind:'document',title:session.info.name,text:r.context?.text||'',sourceId:courseDocument?.sourceId||new URLSearchParams(location.search).get('source')!,documentId:session.info.id,previewVersion:session.info.previewVersion,page:r.context?.page||r.page,regions:r.context?.regions||[]}}/>}{courseDocument?.reload&&<Button variant="ghost" size="small" onClick={courseDocument.reload}>重新载入服务器版本</Button>}<span title={session.info.id}>{courseDocument ? '服务端笔记' : workbench ? '本机笔记' : 'SHA-256 '+session.info.id.slice(0, 12)+'…'} · 第 {r.page} 页 · {session.annotations.length} 个批注</span>{workbench && <Button variant="ghost" size="small" onClick={() => setStorageDetails(!storageDetails)}>保存说明</Button>}<Button variant="secondary" size="small" onClick={() => { if (!session.blocked) { dirty.current = true; void persist() } else setMessage('原数据受保护，自动保存已暂停；请先导出原始数据排查，不会覆盖。') }}>重试保存</Button><Button variant="secondary" size="small" onClick={() => exportJson({ schema: 1, document: session.info, annotations: session.annotations, reader: session.reader, savedAt: new Date().toISOString() }, 'fe-v01-reader-export.json')}>导出验证 JSON</Button>{session.blocked && <Button variant="secondary" size="small" onClick={() => exportJson(session.raw, 'fe-v01-original-storage.json')}>导出原始存储</Button>}<label hidden={!dev}><input type="checkbox" checked={failure} onChange={e => setFailure(e.target.checked)} />夹具：存储写失败</label></footer>
    </>}
  </div>
}
