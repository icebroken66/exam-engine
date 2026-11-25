export function readingRoute(courseId:string,sourceId:string){return '#/courses/'+encodeURIComponent(courseId)+'/reader?source='+encodeURIComponent(sourceId)}
export function allowWorkspaceNavigation(){
  const detail={blocked:false}
  window.dispatchEvent(new CustomEvent('reader:before-navigate',{detail}))
  return !detail.blocked
}
export function readPanels(){
  try{const p=JSON.parse(localStorage.getItem('exam-engine:panels:v1')||'null');return{left:p?.schema===1&&typeof p.left==='boolean'?p.left:true,right:p?.schema===1&&typeof p.right==='boolean'?p.right:false}}
  catch{return{left:true,right:false}}
}
