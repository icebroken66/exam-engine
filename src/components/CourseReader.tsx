import {useEffect,useState} from 'react'
import {ReaderLab} from '../reader/ReaderLab'
import {openCourseDocument} from '../reader/courseStorage'
import {Button} from '../reader/boardui/button'
import '../reader/workbench/workbench.css'
export default function CourseReader({courseId,sourceId,assistantOpen,onAssistantChange}:{courseId:string;sourceId:string;assistantOpen:boolean;onAssistantChange:(open:boolean)=>void}){
 const [document,setDocument]=useState<Awaited<ReturnType<typeof openCourseDocument>>|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0)
 useEffect(()=>{const controller=new AbortController();setDocument(null);setError('');void openCourseDocument(courseId,sourceId,controller.signal).then(value=>{if(!controller.signal.aborted)setDocument(value)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'读取资料失败')});return()=>controller.abort()},[courseId,sourceId,reload])
 return <div className="wb-review wb-embedded"><a className="embedded-return" href={'#/courses/'+encodeURIComponent(courseId)+'/materials'}>返回课程资料</a>{document?<ReaderLab key={courseId+sourceId+reload} workbench courseDocument={{...document,courseId,sourceId,reload:()=>{if(window.confirm('请先导出当前内容。重新载入将放弃未保存内容，是否继续？'))setReload(n=>n+1)}}} globalAssistant={{unified:true,open:assistantOpen,onOpenChange:onAssistantChange,host:null,onDocumentChange:()=>{}}}/>:<main className="rl-empty"><h1>{error?'课程资料暂时无法打开':'正在读取课程资料…'}</h1>{error&&<p role="alert">{error}</p>}<Button variant="secondary" onClick={()=>setReload(n=>n+1)}>重试读取课程资料</Button></main>}</div>
}
