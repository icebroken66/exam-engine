import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'

const labels: Record<string, string> = {
  start: '正在生成并验证第一题',
  next: '正在根据最新资料安排下一步',
  answer: '正在保存作答并核对答案',
  hint: '正在读取当前题目的提示',
  tutoring: '正在结合当前题、你的思路与资料进行带学',
  recovery: '正在核对服务器已保存的进度',
}

export function LearningOperationStatus({ operation }: { operation: string }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [operation])
  return <div className="learning-operation" aria-label="当前操作进度">
    <div><LoaderCircle size={18} className="spinning" /><strong role="status">{labels[operation] ?? '正在处理学习请求'}…</strong><span aria-hidden="true">已等待 {elapsed} 秒</span></div>
    <p>{operation === 'recovery' ? '这里只读取记录，不会重复提交答案或生成新题。' : '模型处理可能需要一些时间，请等待本次结果。当前标签页的作答草稿会保留；请勿重复提交。'}</p>
    {elapsed >= 30 && operation !== 'recovery' && <p>等待超过 30 秒。若连接中断，页面会先核对服务器记录；耗时不代表处理已失败。</p>}
  </div>
}
