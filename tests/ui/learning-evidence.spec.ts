import { expect, test } from '@playwright/test'

test('跨轮次依据可追溯、失败可重读、窄屏和纠错后刷新', async ({ page }, testInfo) => {
  const course = { id: 'evidence-course', name: '信号', school: '验收', created_at: '2026-11-09T00:00:00Z', archived_at: null, exam_date: null }
  let fail = true, corrected = false, writes = 0
  const session = (id: string) => ({ id, course_id: course.id, stage: 'completed', created_at: '2026-11-08T00:00:00Z' })
  const item = (id: string) => ({ session_id: id, task_id: `${id}-task`, attempt_id: `${id}-answer`, knowledge_point: id === 'old' ? '旧轮次零点跳变' : '周期信号', sub_skill: '分布求导', verdict: 'correct', hints_used: 0, taken_at: '2026-11-07T00:00:00Z', usable: true, recommendation: 'due', explanation: corrected ? '最近有效作答未通过，先处理缺失要点' : '距作答已满24小时，可用未见题检查保持', due_at: null })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') writes++
    if (path === '/api/health') return route.fulfill({ json: { status: 'ok' } })
    if (path === '/api/courses') return route.fulfill({ json: [course] })
    if (path.endsWith('/sources')) return route.fulfill({ json: [] })
    if (path.endsWith('/learning-sessions/current')) return route.fulfill({ json: null })
    if (path.endsWith('/learning-sessions')) return route.fulfill({ json: [session('recent'), session('old')] })
    if (path.endsWith('/learning-evidence')) {
      if (fail) return route.fulfill({ status: 503, json: { detail: '读取故障' } })
      return route.fulfill({ json: { course_id: course.id, total: 2, usable_count: 2, excluded_count: 0, due_count: corrected ? 1 : 2, page: 1, page_size: 20, limitation: '未继承掌握。资料版本变化时保守暂停复用。', items: [item('recent'), item('old')] } })
    }
    if (path.endsWith('/history')) {
      const id = path.includes('/old/') ? 'old' : 'recent'
      return route.fulfill({ json: { session: session(id), tasks: [{ task: { id: `${id}-task`, kind: 'diagnostic', knowledge_point: item(id).knowledge_point, stem: id === 'old' ? '可追溯的旧题题干' : '近期题干', options: [], study_answer: null }, attempts: [] }] } })
    }
    return route.fulfill({ status: 404, json: { detail: 'unused' } })
  })
  await page.goto(`/#/courses/${course.id}/history`)
  const panel = page.getByRole('region', { name: '下次复习依据' })
  await expect(panel.getByRole('alert')).toContainText('读取失败不表示没有记录')
  fail = false
  await panel.getByRole('button', { name: '刷新复习依据' }).click()
  await expect(panel).toContainText('旧轮次零点跳变')
  await panel.getByRole('button', { name: '查看这次作答与纠错' }).last().click()
  await expect(page.locator('.history-detail')).toContainText('可追溯的旧题题干')
  corrected = true
  await panel.getByRole('button', { name: '刷新复习依据' }).click()
  await expect(panel).toContainText('先处理缺失要点')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
  await page.screenshot({ path: testInfo.outputPath('learning-evidence-mobile.png'), fullPage: true })
  expect(writes).toBe(0)
})
