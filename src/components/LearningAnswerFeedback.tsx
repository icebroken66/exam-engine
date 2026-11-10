import { FileText } from 'lucide-react'
import type { LearningTask } from '../lib/clients/learning'
import { StudyContent } from './StudyContent'

export function GradingBadge({ task }: { task: LearningTask }) {
  const attempt = task.latest_attempt
  if (!attempt) return null
  const label = attempt.grading_layer === 'human_correction' ? '人工纠正' : attempt.grading_layer === 'deterministic'
    ? '确定性判分'
    : attempt.mocked
      ? 'MOCK 流程判分'
      : '真实模型判分'
  return <span className={`grading-badge ${attempt.mocked ? 'mock' : ''}`}>{label}</span>
}

export function EvidenceAndAnswer({ task }: { task: LearningTask }) {
  if (!task.study_answer) return null
  return (
    <div className="learning-explanation">
      <div>
        <span className="mini-label">{task.source_track === 'course' ? '课程依据下的参考答案' : '通用知识参考答案 · 非校本原题'}</span>
        <StudyContent>{task.study_answer}</StudyContent>
      </div>
      {task.analysis && <div><span className="mini-label">针对性讲解</span><StudyContent>{task.analysis}</StudyContent></div>}
      {task.citations.length > 0 && (
        <div className="learning-citations">
          <span className="mini-label"><FileText size={13} /> 回到课程原文</span>
          {task.citations.map((citation) => (
            <blockquote key={citation.evidence_id}>
              <p>{citation.excerpt}</p>
              <cite>{citation.source_name} · {citation.node_title}{citation.page_number ? ` · 第 ${citation.page_number} 页` : ''}</cite>
            </blockquote>
          ))}
        </div>
      )}
    </div>
  )
}
