import { useState, type ReactNode } from 'react'
import type { Annotation } from '../types'
import { Button } from '../boardui/button'
import { Input } from '../boardui/input'
export function NotesNavigation({annotations, children, locate, close}: {annotations:Annotation[];children:ReactNode;locate:(a:Annotation)=>void;close:()=>void}){
  const [tab,setTab]=useState<'pages'|'notes'>('pages'),[query,setQuery]=useState('')
  const items=annotations.filter(a=>!query.trim() || (a.anchor.page+' '+(a.kind==='note'?a.text:a.kind==='highlight'?(a.anchor.text||'高亮'):'笔迹')).includes(query.trim())).sort((a,b)=>a.anchor.page-b.anchor.page)
  return <aside className="wb-navigation" aria-label="资料导航"><header><div role="group" aria-label="导航内容"><Button variant={tab==='pages'?'secondary':'ghost'} size="small" aria-pressed={tab==='pages'} onClick={()=>setTab('pages')}>页面</Button><Button variant={tab==='notes'?'secondary':'ghost'} size="small" aria-pressed={tab==='notes'} onClick={()=>setTab('notes')}>笔记 {annotations.length}</Button></div><Button size="small" variant="ghost" aria-label="收起导航" title="收起导航" onClick={close}>‹</Button></header>
    {tab==='pages'?children:<><Input className="wb-search" size="small" label="检索笔记" placeholder="页码或文字内容" value={query} onChange={setQuery}/><div className="wb-notes wb-scroll-fade">{!annotations.length?<div className="wb-quiet"><strong>还没有笔记</strong><p>选字、高亮或添加贴条后，笔记会集中显示在这里。</p></div>:!items.length?<div className="wb-quiet">未找到匹配笔记。<Button size="small" variant="ghost" onClick={()=>setQuery('')}>清除检索</Button></div>:items.map((a,i)=><div key={a.id}>{(i===0||items[i-1].anchor.page!==a.anchor.page)&&<h3>第 {a.anchor.page} 页</h3>}<Button className="wb-note-item" variant="ghost" onClick={()=>locate(a)}><span className="wb-note-kind">{a.kind==='note'?'文字贴条':a.kind==='ink'?'自由笔迹':'区域高亮'}</span><span>{a.kind==='note'?(a.text||'空白贴条'):a.anchor.text||'查看原页标记'}</span></Button></div>)}</div></>}
  </aside>
}
