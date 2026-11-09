import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const course = { id: 'coverage-course', school: '测试学校', name: '覆盖记录验收', exam_date: null, archived_at: null, scope_text: '', created_at: '2026-11-08T00:00:00Z' }
const unit = { source_id: 'source-one', source_name: '多章节课件.pdf', source_status: 'ready', node_id: 'page-one', title: '第一章', page_start: 1, page_end: 1, text_status: 'available', semantic_status: 'untracked', evidence: [{ id: 'evidence-one', page_number: 1, excerpt: '课程原文节选' }], questions: [{ id: 'q-one', status: 'draft', provenance: 'original' }], topics: ['条件与规则'], diagnostic_tasks: [{ id: 'task-one', session_id: 'session-one', knowledge_point: '条件与规则', sub_skill: '条件辨析', verdict: 'incorrect' }], retest_tasks: [] }
const coverage = { course_id: course.id, source_count: 1, unit_count: 2, text_available_units: 2, diagnostic_linked_units: 1, retest_linked_units: 0, limitation: '文本可用不代表逐章理解；整课覆盖分母未知，不计算整课覆盖率。', units: [unit, { ...unit, node_id: 'page-late', title: '第九章（后半部分）', page_start: 90, page_end: 95, evidence: [], questions: [], topics: [], diagnostic_tasks: [] }] }
async function serve(page: Page, state: { fail: boolean }, ledger = coverage) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/health')) return route.fulfill({ json: { status: 'ok' } })
    if (path === '/api/courses') return route.fulfill({ json: [course] })
    if (path.endsWith('/sources')) return route.fulfill({ json: [] })
    if (path.endsWith('/completeness')) return route.fulfill({ json: { total_sources: 0, ready_sources: 0, attention_sources: 0, evidence_blocks: 0, complete: true, issues: [] } })
    if (path.endsWith('/coverage')) return state.fail ? route.fulfill({ status: 503 }) : route.fulfill({ json: ledger })
    if (path.endsWith('/analytics')) return route.fulfill({ json: { knowledge_points: [], question_types: [], included_original_question_count: 0 } })
    return route.fulfill({ status: 404, json: { detail: 'Explicit fixture has no matching route' } })
  })
}

test('覆盖记录展示后半章节、未知理解和原页链接，筛选只隐藏已有诊断引用单元', async ({ page }, testInfo) => {
  await serve(page, { fail: false })
  await page.goto(`/#/courses/${course.id}/analytics`)
  const panel = page.getByRole('region', { name: '资料与学习覆盖记录', exact: true })
  await expect(panel).toContainText('整课覆盖分母未知')
  await expect(panel).toContainText('逐单元语义理解：未建立记录')
  await expect(panel.getByRole('heading', { name: '多章节课件.pdf · 第九章（后半部分）' })).toBeVisible()
  await expect(panel.getByRole('link', { name: '打开原件 · 第 90 页', exact: true })).toHaveAttribute('href', '/api/sources/source-one/file?inline=true#page=90')
  await panel.getByRole('checkbox').check()
  await expect(panel.getByRole('heading', { name: '多章节课件.pdf · 第一章', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('heading', { name: '多章节课件.pdf · 第九章（后半部分）' })).toBeVisible()
  await page.reload()
  await panel.getByText('查看依据与学习记录', { exact: true }).first().click()
  await expect(panel).toContainText('课程原文节选')
  await expect(panel.getByRole('link', { name: '查看所在轮次' })).toHaveAttribute('href', `#/courses/${course.id}/learn?session=session-one`)
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
  await page.screenshot({ path: testInfo.outputPath('coverage-mobile.png'), fullPage: true })
})

test('覆盖读取失败明确提示未知，重试成功后恢复台账', async ({ page }) => {
  const state = { fail: true }
  await serve(page, state)
  await page.goto(`/#/courses/${course.id}/analytics`)
  await expect(page.getByRole('alert')).toContainText('读取失败不表示没有缺口')
  await expect(page.locator('.coverage-counts')).toHaveCount(0)
  state.fail = false
  await page.getByRole('button', { name: '重新读取覆盖记录', exact: true }).click()
  await expect(page.locator('.coverage-counts')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})


test('分页保留末尾单元，搜索可直接定位后半章节', async ({ page }) => {
  const units = Array.from({ length: 25 }, (_, index) => ({ ...unit, node_id: `node-${index}`, title: `章节编号${index + 1}`, diagnostic_tasks: [] }))
  await serve(page, { fail: false }, { ...coverage, unit_count: 25, units })
  await page.goto(`/#/courses/${course.id}/analytics`)
  const panel = page.getByRole('region', { name: '资料与学习覆盖记录', exact: true })
  await expect(panel.locator('article')).toHaveCount(20)
  await expect(panel).toContainText('第 1 / 2 页')
  await panel.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(panel.getByRole('heading', { name: '多章节课件.pdf · 章节编号25', exact: true })).toBeVisible()
  await panel.getByRole('searchbox', { name: '查找资料、章节或已关联考点' }).fill('章节编号25')
  await expect(panel.locator('article')).toHaveCount(1)
  await expect(panel).toContainText('第 1 / 1 页')
})
