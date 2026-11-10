import assert from 'node:assert/strict'
import test from 'node:test'
import { offlineEnvironment, maintenanceSteps } from './verify-maintenance.mjs'

test('offline environment overrides paid credentials and all inherited data paths without mutating parent', () => {
  const parent = { OPENAI_API_KEY: 'fixture-secret', MODEL_PROVIDER: 'openai-compatible', DATABASE_URL: 'sqlite:///fixture-production.db', EXAM_ENGINE_DATA_DIR: 'fixture-production', EXAM_ENGINE_API_URL: 'https://fixture.invalid', MODEL_INPUT_USD_PER_MILLION: 'invalid', MODEL_COURSE_TOKEN_BUDGET: 'invalid', PYTHONPATH: 'original-backend', EXAM_ENGINE_UI_PREVIEW: '0', PATH: 'fixture-path' }
  const env = offlineEnvironment(parent, 'isolated', 'checkout')
  assert.equal(env.MODEL_PROVIDER, 'mock')
  assert.equal(env.MODEL_INPUT_USD_PER_MILLION, '0')
  assert.equal(env.EXAM_ENGINE_DATA_DIR, 'isolated')
  assert.equal(env.EXAM_ENGINE_API_URL, 'http://127.0.0.1:1')
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.EXAM_ENGINE_UI_PREVIEW, '1')
  assert.ok(env.PYTHONPATH.endsWith('backend'))
  assert.ok(!env.PYTHONPATH.includes('original-backend'))
  assert.equal(env.MODEL_COURSE_TOKEN_BUDGET, undefined)
  assert.ok(env.DATABASE_URL.includes('isolated'))
  assert.equal(env.PATH, parent.PATH)
  assert.equal(parent.MODEL_PROVIDER, 'openai-compatible')
})

test('complete maintenance plan includes all regression layers without opt-in paid or demo mutation scripts', () => {
  const steps = maintenanceSteps('root', 'python', 'npm-cli')
  assert.deepEqual(steps.map(step => step.name), ['runner-contract', 'backend', 'frontend-unit', 'build', 'browser-mock', 'sql-fixture', 'signals-fixture'])
  assert.ok(steps.every(step => step.cwd === 'root'))
  assert.ok(steps.every(step => !step.args.some(arg => /evaluate_|prepare_demo|smoke_dev|--live/.test(arg))))
})
