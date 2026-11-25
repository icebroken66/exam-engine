import { ShieldCheck } from 'lucide-react'
import type { LearningTask } from '../lib/clients/learning'
import { StudyContent } from './StudyContent'

function taskLabel(task: LearningTask) {
  if (task.kind === 'diagnostic') return '诊断题'
  return task.kind === 'practice' ? '同类练习' : '独立重测'
}

export function CurrentLearningQuestion({ task, graded }: { task: LearningTask; graded: boolean }) {
  return (
    <>
          <div className="task-heading" id="current-question" tabIndex={-1}>
            <div>
              <span className="task-kicker">{taskLabel(task)} · {task.knowledge_point}</span>
              <StudyContent>{task.stem}</StudyContent>
            </div>
            <span className="provenance-badge">
              {task.provenance === 'original'
                ? task.answer_provenance === 'ai'
                  ? '真实原题 · AI 参考答案'
                  : task.answer_provenance === 'human' ? '真实原题 · 人工校订答案' : task.answer_provenance === 'source' ? '真实原题 · 原卷答案' : '真实原题 · 答案待确认'
                : task.provenance === 'adapted'
                  ? '真实原题改编'
                  : task.source_track === 'general' ? '通用生成题' : '无合适原题 · 循证原创'}
            </span>
          </div>
          <details className="task-quality"><summary>题目质量与适用范围</summary><div className="task-blueprint">
            <span>{task.sub_skill}</span>
            <span>{task.cognitive_level} · {task.difficulty_prior}</span>
          </div>
          <p className="task-limitation">{task.visible_limitation}</p>
          <p className="task-validation"><ShieldCheck size={13} /> 独立质量验证：{task.validation_status === 'validated' ? '通过' : task.validation_status}{task.validation_confidence !== null ? ` · ${Math.round(task.validation_confidence * 100)}%` : ''}</p></details>
          {task.source_removed && <p className="notice" role="status">这道题引用的资料已移除，已有记录保留。请依据剩余资料重新安排；没有有效资料时需先补传。</p>}
          {graded && task.rubric.length > 0 && (
            <div className="task-rubric"><span className="mini-label">评分要点</span><ul>{task.rubric.map((point) => <li key={point}>{point}</li>)}</ul></div>
          )}

    </>
  )
}
