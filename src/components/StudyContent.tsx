import { lazy, Suspense } from 'react'

const StudyMarkdown = lazy(() => import('./StudyMarkdown'))

export function StudyContent({ children }: { children: string }) {
  return <Suspense fallback={<div className="study-content study-content-pending">{children}</div>}>
    <StudyMarkdown>{children}</StudyMarkdown>
  </Suspense>
}
