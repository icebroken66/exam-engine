import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const course = { id: 'course-one', name: '数据库基础', school: '测试学校', exam_date: null, archived_at: null, created_at: '2026-11-08T00:00:00Z', scope_text: '' }
const source = {
  id: 'source-one', course_id: course.id, original_name: '数据库试卷.md', extension: '.md', size_bytes: 200,
  status: 'queued', material_type: 'past_exam', material_confidence: 1, material_rationale: '', processing_note: '',
  processing_stage: 'queued', processing_completed: 0, processing_total: 0, processing_started_at: null,
  processing_finished_at: null, processing_duration_seconds: 0, origins: [], sha256: 'abcdef1234', relative_path: '数据库试卷.md',
}
type SourceFixture = typeof source
const question = {
  id: 'question-one', course_id: course.id, source_id: source.id, stem: '简述事务隔离性的作用。', question_type: 'short_answer',
  options: [], answer: '避免并发事务之间不恰当的干扰。', answer_provenance: 'ai', extraction_confidence: 0.95,
  extraction_issues: [], analysis: '核对并发执行约束。', knowledge_points: ['事务隔离性'], provenance: 'original',
  origin_year: 2025, status: 'verified', version: 1, reviewed_at: null as string | null, stem_reviewed_at: null as string | null, answer_reviewed_at: null as string | null, citations: [],
}

// These are network-failure regression tests with explicit fixtures. Real-model
// acceptance is performed separately against an isolated database.
async function serve(page: Page, state: {
  sources: SourceFixture[]; offline?: boolean; currentUnavailable?: boolean; questions?: typeof question[];
  onUpload?: () => void; onEdit?: (body: { expected_version: number }) => void;
}) {
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url())
    const method = route.request().method()
    if (pathname === '/api/health') return route.fulfill({ json: { status: 'ok' } })
    if (pathname === '/api/courses') return route.fulfill({ json: [course] })
    if (pathname.endsWith('/sources/batch')) {
      state.onUpload?.()
      return route.fulfill({ json: { batch_id: 'batch-one', imported_count: 1, deduplicated_count: 0, failures: [], results: [{ source, deduplicated: false }] } })
    }
    if (pathname.endsWith('/sources')) return state.offline
      ? route.fulfill({ status: 503, json: { detail: 'source service temporarily unavailable' } })
      : route.fulfill({ json: state.sources })
    if (pathname.endsWith('/completeness')) return route.fulfill({ json: { total_sources: state.sources.length, ready_sources: state.sources.filter(item => item.status === 'ready').length, evidence_blocks: 1, attention_sources: state.sources.filter(item => item.status !== 'ready').length, complete: state.sources.every(item => item.status === 'ready'), issues: [] } })
    if (pathname.endsWith('/learning-context')) {
      const ready = state.sources.some(item => item.status === 'ready') && !state.sources.some(item => ['queued', 'running'].includes(item.status))
      return route.fulfill({ json: { course_id: course.id, can_start: ready, preparation_status: ready ? 'ready_to_confirm' : 'assessing_materials', knowledge_mode: ready ? 'course_specific' : 'general', scope_source: 'course_evidence', scope_text: ready ? '事务隔离性' : '', topics: ready ? ['事务隔离性'] : [], total_sources: state.sources.length, usable_sources: ready ? 1 : 0, parsing_sources: ready ? 0 : state.sources.length, failed_sources: 0, missing_materials: [], visible_limitation: '测试资料范围' } })
    }
    if (pathname.endsWith('/learning-sessions/current')) return state.currentUnavailable
      ? route.fulfill({ status: 503, json: { detail: 'current progress temporarily unavailable' } })
      : route.fulfill({ json: null })
    if (pathname.endsWith('/questions') && method === 'GET') return route.fulfill({ json: state.questions ?? [] })
    if (pathname.endsWith('/questions/question-one') && method === 'PUT') {
      state.onEdit?.(route.request().postDataJSON())
      return route.fulfill({ status: 409, json: { detail: '题目已被更新，请刷新后再提交校题修改' } })
    }
    return route.fulfill({ status: 404, json: { detail: `Unexpected test request: ${method} ${pathname}` } })
  })
}

test('自动重连后，停留在学习页也能从排队更新为可诊断', async ({ page }) => {
  const state = { sources: [source], offline: true }
  await serve(page, state)
  await page.goto(`/#/courses/${course.id}/learn`)
  await expect(page.locator('.source-progress:visible .status-reconnect')).toBeVisible()
  state.offline = false
  await expect(page.locator('.source-progress:visible')).toContainText('解析已排队', { timeout: 15000 })
  state.sources = [{ ...source, status: 'ready', processing_stage: 'ready' }]
  await expect(page.getByRole('button', { name: '确认计划，开始动态诊断', exact: true })).toBeEnabled({ timeout: 15000 })
  await expect(page.locator('.workspace-tabs [aria-current=page]')).toHaveText('开始学习')
})

test('上传成功后读取清单失败，不误报上传失败或重新保留成功文件', async ({ page }) => {
  const state = { sources: [] as SourceFixture[], offline: false, onUpload() { this.offline = true; this.sources = [source] } }
  await serve(page, state)
  await page.goto(`/#/courses/${course.id}/materials`)
  await page.locator('.source-panel input[type=file]').first().setInputFiles({ name: '数据库试卷.md', mimeType: 'text/markdown', buffer: Buffer.from('课程资料') })
  await page.locator('.rights-check input').check()
  await page.getByRole('button', { name: /批量导入.*并自动解析/ }).click()
  await expect(page.locator('.source-message')).toContainText('本批接收 1 份新资料')
  await expect(page.locator('.materials-view .status-reconnect')).toBeVisible()
  await expect(page.locator('.source-error')).toHaveCount(0)
  await expect(page.locator('.selected-file-list')).toHaveCount(0)
  state.offline = false
  await expect(page.locator('.source-record')).toHaveCount(1, { timeout: 15000 })
})

test('进度读取失败时禁止开始新轮次，重试后恢复入口', async ({ page }) => {
  const state = { sources: [{ ...source, status: 'ready', processing_stage: 'ready' }], currentUnavailable: true }
  await serve(page, state)
  await page.goto(`/#/courses/${course.id}/learn`)
  await expect(page.getByRole('button', { name: '重新读取课程与进度' })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认计划，开始动态诊断', exact: true })).toBeDisabled()
  state.currentUnavailable = false
  await page.getByRole('button', { name: '重新读取课程与进度' }).click()
  await expect(page.getByRole('button', { name: '确认计划，开始动态诊断', exact: true })).toBeEnabled()
})

test('后台资料完成刷新题库时保留未保存编辑，保存仍校验原版本', async ({ page }) => {
  let submittedVersion: number | undefined
  const state = { sources: [source], questions: [question], onEdit(body: { expected_version: number }) { submittedVersion = body.expected_version } }
  await serve(page, state)
  await page.goto(`/#/courses/${course.id}/questions`)
  await page.getByRole('button', { name: '人工校题', exact: true }).click()
  await page.getByRole('textbox', { name: '题干', exact: true }).fill('尚未保存的题干修订')
  state.questions = [{ ...question, version: 2 }]
  state.sources = [{ ...source, status: 'ready', processing_stage: 'ready' }]
  await expect(page.locator('.question-flags')).toContainText('V2', { timeout: 15000 })
  await expect(page.getByRole('textbox', { name: '题干', exact: true })).toHaveValue('尚未保存的题干修订')
  await page.getByLabel('本次修改说明').fill('核对原件后修订')
  await page.getByRole('button', { name: '保存校题修改' }).click()
  await expect(page.locator('.question-bank-error')).toContainText('题目已被更新')
  expect(submittedVersion).toBe(1)
  await expect(page.getByRole('textbox', { name: '题干', exact: true })).toHaveValue('尚未保存的题干修订')
})


test('题干与答案分别确认，刷新保留状态且筛选区分待确认部分', async ({ page }) => {
  const state = { sources: [{ ...source, status: 'ready', processing_stage: 'ready' }], questions: [{ ...question, status: 'draft' }] }
  await serve(page, state)
  const scopes: string[] = []
  await page.route('**/api/questions/question-one/review', async route => {
    const body = route.request().postDataJSON()
    expect(body.expected_version).toBe(state.questions[0].version)
    scopes.push(body.scope)
    const current = state.questions[0]
    const next = { ...current, version: current.version + 1 }
    if (body.scope === 'stem') next.stem_reviewed_at = '2026-11-08T00:00:00Z'
    if (body.scope === 'answer') next.answer_reviewed_at = '2026-11-08T00:00:01Z'
    if (next.stem_reviewed_at && next.answer_reviewed_at) { next.reviewed_at = next.answer_reviewed_at; next.status = 'verified' }
    state.questions = [next]
    await route.fulfill({ json: next })
  })
  await page.goto(`/#/courses/${course.id}/questions`)
  await page.getByRole('button', { name: '确认题干与选项', exact: true }).click()
  await expect(page.locator('.question-flags')).toContainText('题干已人工确认')
  await expect(page.locator('.question-flags')).toContainText('答案待人工确认')
  await expect(page.locator('.question-flags')).not.toContainText('人工校题通过')
  await page.reload()
  await expect(page.locator('.question-flags')).toContainText('题干已人工确认')
  await page.getByLabel('确认状态').selectOption('stem')
  await expect(page.locator('.question-record')).toHaveCount(0)
  await page.getByLabel('确认状态').selectOption('answer')
  await page.getByRole('button', { name: '确认答案与解析', exact: true }).click()
  await expect(page.locator('.question-record')).toHaveCount(0)
  await page.getByLabel('确认状态').selectOption('human')
  await expect(page.locator('.question-flags')).toContainText('人工校题通过')
  expect(scopes).toEqual(['stem', 'answer'])
})


test('移除先说明保留历史，取消不写入，关联变化后须重读影响才能确认', async ({ page }) => {
  const state = { sources: [{ ...source, status: 'ready', processing_stage: 'ready' }] }
  await serve(page, state)
  let deletes = 0
  let signature = 'a'.repeat(64)
  await page.route('**/api/sources/source-one/removal-impact', route => route.fulfill({ json: {
    source_id: source.id, source_name: source.original_name, evidence_count: 2, question_count: 3,
    history_task_count: 1, pending_task_count: 1, blocked_reason: '', signature, removed: false,
  } }))
  await page.route('**/api/sources/source-one', async route => {
    deletes++
    expect(route.request().postDataJSON().expected_signature).toBe(signature)
    if (deletes === 1) {
      signature = 'b'.repeat(64)
      return route.fulfill({ status: 409, json: { detail: '资料关联内容已变化，请重新查看移除影响后确认' } })
    }
    state.sources = []
    await route.fulfill({ json: { removed: true } })
  })
  await page.goto(`/#/courses/${course.id}/materials`)
  await page.getByRole('button', { name: `移除 ${source.original_name}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '从课程移除资料' })
  await expect(dialog).toContainText('不会彻底销毁文件')
  await expect(dialog.getByRole('button', { name: '确认从课程移除', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(deletes).toBe(0)
  await page.getByRole('button', { name: `移除 ${source.original_name}`, exact: true }).click()
  await dialog.getByRole('button', { name: '确认从课程移除', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('关联内容已变化')
  await expect(dialog.getByRole('button', { name: '确认从课程移除', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '重新查看影响', exact: true }).click()
  await dialog.getByRole('button', { name: '确认从课程移除', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.source-record')).toHaveCount(0)
  expect(deletes).toBe(2)
})
