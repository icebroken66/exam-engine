import { useState } from 'react'
import StudyMarkdown from '../../components/StudyMarkdown'
import { Button } from '../boardui/button'
const text = ['这是一段**固定示例解释**，用于评审阅读与引用的呈现，不是对当前课件的分析。','### 先看条件，再理解结论','阅读复杂定义时，先区分适用范围、前提条件和结论。选区只是讨论的入口，完整理解仍需要回到原文核对。','1. 找出术语首次出现的位置，确认当前资料中的含义。\n2. 区分必要条件与充分条件。\n3. 用简单例子检验理解，再核对遗漏。','### 公式排版样例','$$P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)},\\qquad P(B)>0$$','分母不为零是公式成立的前提。这里只演示数学渲染，不说明当前材料与概率相关。','### 回到资料核对','点击引用查看固定演示区域，再返回原阅读位置。个人批注不会因跳转而修改。','> 把仍未理解的条件写成贴条，保留自己的问题；不要把示例解释当作资料原文。'].join('\n\n')
export function ExampleExplanation({page, jump}: {page:number;jump:()=>void}){
  const [shown,setShown]=useState(false)
  return <section className="wb-example"><div className="wb-example-label">未连接 AI · 固定内容演示</div><Button variant="secondary" size="small" onClick={()=>setShown(!shown)}>{shown?'收起示例解释':'演示解释'}</Button>{shown&&<><StudyMarkdown>{text}</StudyMarkdown><Button className="wb-reference" variant="secondary" onClick={jump}>课件引用 · 第 {page} 页<span>固定引用，点击定位演示区域 ↗</span></Button><Button className="wb-reference" variant="secondary" onClick={jump}>条件核对 · 第 {page} 页<span>同一资料的固定演示引用 ↗</span></Button></>}</section>
}
