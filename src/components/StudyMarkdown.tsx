import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

export default function StudyMarkdown({ children }: { children: string }) {
  return <div className="study-content"><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
    components={{ a: ({ children: label, ...props }) => <a {...props} target="_blank" rel="noreferrer">{label}</a> }}
  >{children}</ReactMarkdown></div>
}
