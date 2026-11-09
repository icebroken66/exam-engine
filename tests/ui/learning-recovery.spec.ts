import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Explicit mocked network states. Real API/browser acceptance is recorded separately.
const course = { id: 'recovery-course', school: '测试学校', name: '学习恢复验收', exam_date: null, archived_at: null, scope_text: '', created_at: '2026-11-08T00:00:00Z' }
const attempt = { id: 'attempt-one', answer: '互斥等四个条件', verdict: 'incorrect', confidence: 1, feedback: '还需补充必要条件', missing_points: ['不可剥夺'], hints_used: 0, grading_layer: 'deterministic', duration_seconds: 10, review_history: [], created_at: '2026-11-08T00:00:01Z' }
function session() {
  return {
    id: 'session-one', course_id: course.id, progress_version: 'a'.repeat(64), stage: 'diagnosing', knowledge_mode: 'course_specific', scope_text: '死锁', visible_limitation: '测试恢复流程',
    current_task: { id: 'task-one', kind: 'diagnostic', ordinal: 1, knowledge_point: '死锁', sub_skill: '解释必要条件', cognitive_level: 'understand', difficulty_prior: 'basic', question_type: 'short_answer', stem: '请解释死锁的四个必要条件。', options: [], provenance: 'original', origin_question_id: null, answer_provenance: 'source', source_track: 'course', visible_limitation: '', rubric: [], prerequisites: [], validation_status: 'validated', validation_confidence: 1, decision_reason: '', reference_answer: null as string | null, study_answer: null as string | null, analysis: null as string | null, citations: [], latest_attempt: null as typeof attempt | null, source_removed: false },
    diagnostic_total: 1, diagnostic_completed: 0, diagnostic_target: 1, practice_completed: 0, retest_passed: 0, points: [], recent_events: [], agent_message: '先独立作答，再检查薄弱点。', next_action: '让 Agent 决定下一步',
  }
}

async function serve(page: Page, state: { current: ReturnType<typeof session> | null; readFails?: boolean }) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/health') return route.fulfill({ json: { status: 'ok' } })
    if (path === '/api/courses') return route.fulfill({ json: [course] })
    if (path.endsWith('/sources')) return route.fulfill({ json: [] })
    if (path.endsWith('/completeness')) return route.fulfill({ json: { total_sources: 0, ready_sources: 0, attention_sources: 0, evidence_blocks: 0, complete: true, issues: [] } })
    if (path.endsWith('/learning-context')) return route.fulfill({ json: { course_id: course.id, can_start: true, preparation_status: 'ready_to_confirm', knowledge_mode: 'course_specific', scope_source: 'course_evidence', scope_text: '死锁', topics: ['死锁'], total_sources: 1, usable_sources: 1, parsing_sources: 0, failed_sources: 0, missing_materials: [], visible_limitation: '' } })
    if (path.endsWith('/learning-sessions/current') || path.endsWith('/learning-sessions/session-one')) {
      return state.readFails ? route.fulfill({ status: 503, json: { detail: '测试读取中断' } }) : route.fulfill({ json: state.current })
    }
    return route.fulfill({ status: 404, json: { detail: `Unexpected fixture request: ${path}` } })
  })
}

test('作答响应丢失且读取失败时锁住写操作，恢复读取后显示已保存判分', async ({ page }) => {
  const initial = session()
  const state = { current: initial, readFails: false }
  await serve(page, state)
  let contextReads = 0
  await page.route('**/learning-context', async route => { contextReads++; await route.fulfill({ status: 503 }) })
  let writes = 0
  await page.route('**/learning-sessions/session-one/attempts', async route => {
    writes++
    expect(route.request().postDataJSON()).toMatchObject({ expected_task_id: 'task-one', expected_progress_version: initial.progress_version, answer: '我的旧题草稿' })
    state.current = { ...initial, progress_version: 'b'.repeat(64), current_task: { ...initial.current_task, latest_attempt: attempt, reference_answer: '四个必要条件', study_answer: '四个必要条件', analysis: '需同时满足' } }
    state.readFails = true
    await route.abort('failed')
  })
  await page.goto(`/#/courses/${course.id}/learn`)
  const answer = page.getByRole('textbox', { name: '你的独立作答' })
  await answer.fill('我的旧题草稿')
  await page.getByRole('button', { name: '提交独立作答', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新读取已保存进度', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '提交独立作答', exact: true })).toBeDisabled()
  await expect(answer).toHaveValue('我的旧题草稿')
  state.readFails = false
  await page.getByRole('button', { name: '重新读取已保存进度', exact: true }).click()
  await expect(page.locator('.recovery-notice')).toContainText('服务器保存的最新进度')
  await expect(page.getByRole('button', { name: '让 Agent 决定下一步', exact: true })).toBeEnabled()
  expect(writes).toBe(1)
  expect(contextReads).toBe(0)
  expect(await page.evaluate(() => sessionStorage.getItem('answer:task-one'))).toBe('我的旧题草稿')
})

test('下一步等待显示耗时，响应丢失后读回补缺阶段且不自动重发', async ({ page }) => {
  await page.clock.install()
  const initial = session()
  initial.current_task.latest_attempt = attempt
  initial.current_task.reference_answer = '四个必要条件'
  initial.current_task.study_answer = '四个必要条件'
  initial.current_task.analysis = '补齐条件'
  const state = { current: initial }
  await serve(page, state)
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let writes = 0
  await page.route('**/learning-sessions/session-one/next', async route => {
    writes++
    expect(route.request().postDataJSON()).toMatchObject({ expected_task_id: 'task-one', expected_progress_version: initial.progress_version })
    await gate
    state.current = { ...initial, stage: 'remediating', progress_version: 'b'.repeat(64), agent_message: '先补缺，再练习' }
    await route.abort('failed')
  })
  await page.goto(`/#/courses/${course.id}/learn`)
  await page.getByRole('button', { name: '让 Agent 决定下一步', exact: true }).click()
  await expect(page.locator('.learning-operation')).toContainText('正在根据最新资料安排下一步')
  await page.clock.fastForward(31000)
  await expect(page.locator('.learning-operation')).toContainText('等待超过 30 秒')
  await expect(page.getByRole('button', { name: 'Agent 正在决策…', exact: true })).toBeDisabled()
  release()
  await expect(page.getByRole('button', { name: '开始同类练习', exact: true })).toBeEnabled()
  await expect(page.locator('.recovery-notice')).toContainText('最新进度')
  expect(writes).toBe(1)
})

test('首次诊断响应丢失时读取已建轮次，未生成题目的轮次也有恢复入口', async ({ page }) => {
  const full = session()
  const state: { current: ReturnType<typeof session> | null } = { current: null }
  await serve(page, state)
  let writes = 0
  await page.route('**/courses/recovery-course/learning-sessions', async route => {
    writes++
    state.current = full
    await route.abort('failed')
  })
  await page.goto(`/#/courses/${course.id}/learn`)
  await page.getByRole('button', { name: '确认计划，开始动态诊断', exact: true }).click()
  await expect(page.getByRole('button', { name: '提交独立作答', exact: true })).toBeVisible()
  expect(writes).toBe(1)
  state.current = { ...full, current_task: null } as unknown as ReturnType<typeof session>
  await page.reload()
  await expect(page.getByRole('button', { name: '重试准备当前轮次', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '读取已保存进度', exact: true })).toBeEnabled()
})


for (const kind of ['short_answer', 'multiple_choice']) {
  test(`已判分的${kind}始终显示服务器作答，忽略冲突草稿并支持刷新`, async ({ page }, testInfo) => {
    const current = session()
    const saved = kind === 'multiple_choice' ? '条件甲；条件丙' : '服务器保存的原始作答：互斥与循环等待。'
    current.current_task.question_type = kind
    current.current_task.options = kind === 'multiple_choice' ? ['条件甲', '条件乙', '条件丙'] : []
    current.current_task.latest_attempt = { ...attempt, answer: saved }
    current.agent_message = '依据课程资料安排这一题。'.repeat(30)
    current.current_task.source_removed = true
    await serve(page, { current })
    await page.addInitScript(() => sessionStorage.setItem('answer:task-one', '条件乙：这是未提交的冲突草稿'))
    await page.goto(`/#/courses/${course.id}/learn`)
    const record = page.getByRole('region', { name: '已保存的作答' })
    await expect(record).toContainText(saved)
    await expect(record).not.toContainText('冲突草稿')
    await expect(page.getByRole('textbox', { name: '你的独立作答' })).toHaveCount(0)
    if (kind === 'multiple_choice') {
      await expect(page.getByRole('checkbox', { name: '条件甲', exact: true })).toBeChecked()
      await expect(page.getByRole('checkbox', { name: '条件丙', exact: true })).toBeChecked()
      await expect(page.getByRole('checkbox', { name: '条件乙', exact: true })).not.toBeChecked()
      await expect(page.getByRole('checkbox', { name: '条件甲', exact: true })).toBeDisabled()
    }
    await expect(page.getByRole('heading', { name: '核对作答反馈，再继续下一步', exact: true })).toBeVisible()
    await expect(page.locator('.decision-details p')).not.toBeVisible()
    await expect(page.getByText('这道题引用的资料已移除，已有记录保留。请依据剩余资料重新安排；没有有效资料时需先补传。', { exact: true })).toBeVisible()
    await page.getByText('查看当前学习安排与原因', { exact: true }).click()
    await expect(page.locator('.decision-details p')).toBeVisible()
    await page.reload()
    await expect(record).toContainText(saved)
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    }
    await page.screenshot({ path: testInfo.outputPath('saved-answer-mobile.png'), fullPage: true })
  })
}

test('完成页使用已完成主题数，不把生成题数或零次重测表述为全部通过', async ({ page }) => {
  const current = session()
  current.stage = 'completed'
  current.diagnostic_total = 7
  current.diagnostic_completed = 2
  current.retest_passed = 0
  await serve(page, { current })
  await page.goto(`/#/courses/${course.id}/learn`)
  await expect(page.locator('.learning-complete')).toContainText('已诊断 2 个主题，完成 0 道练习，通过 0 次独立重测')
  await expect(page.locator('.learning-complete')).not.toContainText('独立重测通过了')
  await expect(page.getByRole('link', { name: '查看未检查的资料与覆盖记录' })).toHaveAttribute('href', `#/courses/${course.id}/analytics`)
  await expect(page.getByRole('button', { name: '开始新一轮诊断', exact: true })).toBeEnabled()
})
