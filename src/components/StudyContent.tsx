import { lazy, Suspense } from 'react'

const StudyMarkdown = lazy(() => import('./StudyMarkdown'))

export function StudyContent({ children,allowLinks=true }: { children: string;allowLinks?:boolean }) {
  return <Suspense fallback={<div className="study-content study-content-pending">{children}</div>}>
    <StudyMarkdown allowLinks={allowLinks}>{children}</StudyMarkdown>
  </Suspense>
}
