import {createContext,useContext,useEffect,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
export const TUTORING_OPEN='exam-engine:open-task-tutoring'
export const TutoringHostContext=createContext<{host:HTMLElement|null;available:(v:boolean)=>void}|null>(null)
export function HostedTutoring({children}:{children:ReactNode}){
 const target=useContext(TutoringHostContext)
 useEffect(()=>{target?.available(true);return()=>target?.available(false)},[target?.available])
 return target?.host?createPortal(children,target.host):target?null:<>{children}</>
}
export function openTaskTutoring(){window.dispatchEvent(new Event(TUTORING_OPEN))}
