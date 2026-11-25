import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { normalizeMathMarkdown } from '../lib/mathMarkdown'

export default function StudyMarkdown({ children,allowLinks=true }: { children: string;allowLinks?:boolean }) {
  return <div className="study-content"><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
    components={{ img:({alt,...props})=>allowLinks?<img alt={alt} {...props}/>:<span>{alt||'图片内容未加载'}</span>, a: ({ children: label, ...props }) => allowLinks?<a {...props} target="_blank" rel="noreferrer">{label}</a>:<span>{label}</span> }}
  >{normalizeMathMarkdown(children)}</ReactMarkdown></div>
}
