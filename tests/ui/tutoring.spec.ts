import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
const course = { id: 'tutor-course', name: '关系代数', school: '测试', archived_at: null, exam_date: null, created_at: '2026-11-09T00:00:00Z' }
function fixture(retest = false) {
  const current = { id: 's1', course_id: course.id, progress_version: 'a'.repeat(64), stage: retest ? 'retesting' : 'diagnosing', knowledge_mode: 'course_specific', scope_text: '关系代数', diagnostic_total: 1, diagnostic_completed: 0, practice_completed: 0, retest_passed: 0, points: [], recent_events: [], agent_message: '先作答', next_action: '下一步', current_task: { id: 't1', kind: retest ? 'retest' : 'diagnostic', ordinal: 1, knowledge_point: '关系代数', sub_skill: '选择与投影', stem: '先选择还是先投影？', options: [], question_type: 'short_answer', provenance: 'evidence_original', rubric: [], prerequisites: [], validation_status: 'validated', validation_confidence: 1, latest_attempt: null, citations: [], reference_answer: null, source_removed: false, help_exposures: 0 } }
  return { current, turns: [] as Record<string, unknown>[], readFails: false, writes: 0, receipts: 0, formal: 0, retestHelp: false }
}
async function serve(page: Page, state: ReturnType<typeof fixture>, loseResponse = false) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const result = () => ({ task_id: 't1', sequence: state.turns.length, turns: state.turns, retest_help_enabled: state.retestHelp, session: state.current })
    if (path === '/api/health') return route.fulfill({ json: { status: 'ok' } })
    if (path === '/api/courses') return route.fulfill({ json: [course] })
    if (path.endsWith('/sources')) return route.fulfill({ json: [] })
    if (path.endsWith('/learning-sessions/current') || path.endsWith('/learning-sessions/s1')) return route.fulfill({ json: state.current })
    if (path.endsWith('/tasks/t1/tutoring')) return state.readFails ? route.fulfill({ status: 503 }) : route.fulfill({ json: result() })
    if (path.endsWith('/received')) { state.receipts++; state.turns[0].delivered_at = '2026-11-09T00:00:02Z'; return route.fulfill({ json: result() }) }
    if (path.endsWith('/attempts')) { state.formal++; return route.fulfill({ json: state.current }) }
    if (path.endsWith('/tutoring') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      expect(body.expected_progress_version).toBe(state.current.progress_version)
      expect(body.expected_sequence).toBe(state.turns.length)
      state.writes++; state.retestHelp = body.allow_retest_help
      state.current.progress_version = 'b'.repeat(64); state.current.current_task.help_exposures = 1
      state.turns.push({ id: `turn-${state.writes}`, request_id: body.request_id, task_id: 't1', sequence: state.writes, student_message: body.message, status: 'saved', reply: { message: '投影后只剩商品名，因此无法再按仓库筛选。', action: 'explain', reason: '检查保留列', help_level: 'step', observation: '待小检查确认', uncertainty: '不计为掌握', evidence_ids: [] }, citations: [], mocked: true, delivered_at: null })
      if (loseResponse) { state.readFails = true; return route.abort('failed') }
      return route.fulfill({ json: result() })
    }
    return route.fulfill({ status: 404 })
  })
}

test('带学交流与正式提交分开，刷新恢复对话及送达记录', async ({ page }, testInfo) => {
  const state = fixture(); await serve(page, state)
  await page.goto(`/#/courses/${course.id}/learn`)
  const chat = page.getByRole('textbox', { name: '和导师交流当前题' })
  await chat.fill('我不是不懂概念，请解释投影后还剩哪些列。')
  await page.getByRole('button', { name: '发送带学消息（不提交答案）', exact: true }).click()
  await expect(page.locator('.tutoring-reply')).toContainText('无法再按仓库筛选')
  expect(state.formal).toBe(0); expect(state.current.stage).toBe('diagnosing')
  await expect.poll(() => state.receipts).toBe(1)
  await page.reload()
  await expect(page.locator('.tutoring-reply')).toContainText('无法再按仓库筛选')
  expect(state.writes).toBe(1)
  for (const width of [1440, 768, 390, 320]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width) }
  await page.screenshot({ path: testInfo.outputPath('tutoring-mobile.png'), fullPage: true })
})

test('保存后断线只重读，不重发，读取失败保留草稿', async ({ page }) => {
  const state = fixture(); await serve(page, state, true)
  await page.goto(`/#/courses/${course.id}/learn`)
  const send = page.getByRole('button', { name: '发送带学消息（不提交答案）', exact: true })
  await page.getByRole('textbox', { name: '和导师交流当前题' }).fill('第二步没懂')
  await send.click()
  await expect(page.getByText('发送结果尚未确认，请先读取带学记录；你的文字仍保留。', { exact: true })).toBeVisible()
  await expect(send).toBeDisabled()
  await expect(page.getByRole('textbox', { name: '和导师交流当前题' })).toHaveValue('第二步没懂')
  state.readFails = false
  await page.getByRole('button', { name: '读取带学记录', exact: true }).click()
  await expect(page.locator('.tutoring-reply')).toContainText('无法再按仓库筛选')
  expect(state.writes).toBe(1); expect(state.formal).toBe(0)
})

test('独立重测明确选择转带学，生成中的回复锁住正式提交', async ({ page }) => {
  const state = fixture(true); await serve(page, state)
  await page.goto(`/#/courses/${course.id}/learn`)
  await page.getByRole('textbox', { name: '和导师交流当前题' }).fill('请帮忙')
  const send = page.getByRole('button', { name: '发送带学消息（不提交答案）', exact: true })
  await expect(send).toBeDisabled()
  await page.getByRole('textbox', { name: '和导师交流当前题' }).press('Control+Enter')
  expect(state.writes).toBe(0)
  await page.getByRole('checkbox', { name: /我选择将本次独立重测转为带学/ }).check()
  await send.click(); await expect(page.locator('.tutoring-reply')).toBeVisible()
  expect(state.retestHelp).toBe(true)
  state.turns.push({ id: 'pending', sequence: 2, student_message: '等待', status: 'running', reply: null, citations: [], mocked: true })
  await page.getByRole('button', { name: '读取带学记录', exact: true }).click()
  await page.getByRole('textbox', { name: '你的正式作答（已接受帮助）' }).fill('我的作答')
  await expect(page.getByRole('button', { name: '提交正式作答（已接受帮助）', exact: true })).toBeDisabled()
  await expect(send).toBeDisabled()
})

test('较早交流折叠，窄屏与键盘可往返当前题、最新交流和正式作答', async ({ page }, testInfo) => {
  const state = fixture()
  for (let index = 0; index < 10; index++) state.turns.push({ id: `old-${index}`, task_id: 't1', sequence: index + 1,
    student_message: `历史思路 ${index}`, status: 'saved', delivered_at: '2026-11-09T00:00:02Z', mocked: true,
    reply: { message: `第 ${index} 轮解释。`.repeat(30), action: 'explain', help_level: 'step', reason: '核对保留列', observation: '不计掌握', uncertainty: '', evidence_ids: ['e1'] },
    citations: [{ evidence_id: 'e1', source_id: 'source1', source_name: '课件.pdf', node_title: '投影', page_number: 52, excerpt: '投影结果去掉重复行。' }] })
  state.current.current_task.help_exposures = 10
  await serve(page, state)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/#/courses/${course.id}/learn`)
  const chat = page.getByRole('textbox', { name: '和导师交流当前题' })
  await expect(chat).toBeEnabled()
  expect((await page.locator('.task-heading').boundingBox())!.height).toBeLessThan(160)
  await expect(page.locator('.tutoring-older')).not.toHaveAttribute('open')
  await expect(page.locator('.tutoring-reply:visible')).toHaveCount(1)
  await page.getByRole('button', { name: '带学交流', exact: true }).click()
  await expect(chat).toBeFocused()
  await page.getByRole('button', { name: '最新交流', exact: true }).click()
  await expect(page.locator('#latest-tutoring')).toBeFocused()
  await page.locator('#latest-tutoring summary').click()
  await expect(page.locator('#latest-tutoring a')).toHaveAttribute('href', /#page=52$/)
  await page.getByRole('button', { name: '正式作答', exact: true }).click()
  const formal = page.getByRole('textbox', { name: '你的正式作答（已接受帮助）' })
  await expect(formal).toBeFocused()
  await formal.fill('保留我的正式作答草稿')
  await page.getByRole('button', { name: '带学交流', exact: true }).click()
  await chat.fill('这一步我仍不明白')
  await chat.press('Control+Enter')
  await expect.poll(() => state.writes).toBe(1)
  expect(state.formal).toBe(0)
  await page.reload()
  await expect(formal).toHaveValue('保留我的正式作答草稿')
  await expect(page.locator('.tutoring-reply:visible')).toHaveCount(1)
  await page.getByRole('button', { name: '当前题', exact: true }).click()
  await expect(page.locator('#current-question')).toBeFocused()
  for (const width of [390, 620, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    if (width <= 640) expect((await page.locator('.task-heading').boundingBox())!.height).toBeLessThan(160)
    await page.getByRole('button', { name: '最新交流', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: testInfo.outputPath(`compact-tutoring-${width}.png`), fullPage: true })
  }
})
