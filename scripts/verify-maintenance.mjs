import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export function offlineEnvironment(parent, directory, root) {
  const env = { ...parent }
  for (const key of Object.keys(env)) {
    if (/^(OPENAI_|MODEL_|DATABASE_URL$|EXAM_ENGINE_DATA_DIR$|EXAM_ENGINE_API_URL$|EXAM_ENGINE_UI_PREVIEW$|PYTHONPATH$)/i.test(key)) delete env[key]
  }
  return { ...env, MODEL_PROVIDER: 'mock', MODEL_ENFORCE_TOKEN_BUDGET: 'false',
    MODEL_INPUT_USD_PER_MILLION: '0', MODEL_OUTPUT_USD_PER_MILLION: '0',
    EXAM_ENGINE_DATA_DIR: directory,
    DATABASE_URL: 'sqlite:///' + path.join(directory, 'exam_engine.db').replaceAll('\\', '/'),
    EXAM_ENGINE_API_URL: 'http://127.0.0.1:1', EXAM_ENGINE_UI_PREVIEW: '1',
    PYTHONPATH: path.join(root, 'backend'), PYTHONUTF8: '1' }
}

export function maintenanceSteps(root, python, npmCli) {
  return [
    { name: 'runner-contract', command: process.execPath, args: ['--test', 'scripts/verify-maintenance.test.mjs'] },
    { name: 'backend', command: python, args: ['-m', 'pytest', 'backend'] },
    { name: 'frontend-unit', command: process.execPath, args: [npmCli, 'test'] },
    { name: 'build', command: process.execPath, args: [npmCli, 'run', 'build'] },
    { name: 'browser-mock', command: process.execPath, args: [npmCli, 'run', 'test:ui'] },
    { name: 'sql-fixture', command: python, args: ['scripts/check_tutoring_sql.py'] },
    { name: 'signals-fixture', command: python, args: ['scripts/check_tutoring_signals.py'] },
  ].map(step => ({ ...step, cwd: root }))
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  const npmCli = process.env.npm_execpath
  if (!existsSync(python) || !npmCli || !existsSync(npmCli)) {
    throw new Error('Run npm run test:maintenance after installing .venv backend[test] and npm ci; see docs/maintenance/README.md.')
  }
  if (process.argv.length > 2) throw new Error('No arguments supported. This entry always runs the complete offline suite.')
  const directory = mkdtempSync(path.join(tmpdir(), 'exam-engine-maintenance-'))
  const env = offlineEnvironment(process.env, directory, root)
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    if (result.status !== 0) throw new Error('Git metadata unavailable')
    return args.includes('-z') ? result.stdout : result.stdout.trim()
  }
  const files = git(['ls-files', '-co', '-z', '--exclude-standard']).split('\0').filter(name => /^(src\/|backend\/|scripts\/|tests\/|package(?:-lock)?\.json$|playwright\.config\.ts$|vite\.config\.ts$|tsconfig[^/]*\.json$|vitest\.config\.ts$)/.test(name))
  const hashes = Object.fromEntries(files.map(name => [name, createHash('sha256').update(readFileSync(path.join(root, name))).digest('hex')]))
  const report = { revision: git(['rev-parse', 'HEAD']), worktree_status: git(['status', '--porcelain']),
    started_at: new Date().toISOString(), node: process.version, platform: process.platform,
    python: spawnSync(python, ['--version'], { encoding: 'utf8' }).stdout.trim(), file_hashes: hashes,
    mode: 'offline-mock-isolated', report_directory: directory,
    limits: 'Engineering and mocked browser checks only; paid replay and human outcomes are not run.', steps: [] }
  const reportPath = path.join(directory, 'report.json')
  const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  let child
  let interrupted = false
  const interrupt = () => {
    interrupted = true
    if (child?.pid) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
      else child.kill('SIGTERM')
    }
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  console.log('Offline Mock + isolated database. Report: ' + reportPath)
  save()
  try {
    for (const step of maintenanceSteps(root, python, npmCli)) {
      if (interrupted) break
      const item = { name: step.name, status: 'running', started_at: new Date().toISOString(), log: path.join(directory, step.name + '.log') }
      report.steps.push(item); save()
      console.log('Running ' + step.name + ' ...')
      const fd = openSync(item.log, 'w')
      const started = Date.now()
      try {
        item.exit_code = await new Promise((resolve, reject) => {
          child = spawn(step.command, step.args, { cwd: step.cwd, env, stdio: ['ignore', fd, fd], windowsHide: true })
          child.once('error', reject)
          child.once('close', code => resolve(code))
        })
        item.status = item.exit_code === 0 && !interrupted ? 'passed' : 'failed'
      } catch (error) {
        item.status = 'failed'; item.error = error.message
      } finally {
        closeSync(fd); child = undefined; item.duration_seconds = (Date.now() - started) / 1000; save()
      }
      console.log(step.name + ': ' + item.status + ' (' + item.duration_seconds + 's), log: ' + item.log)
      if (item.status !== 'passed') break
    }
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    for (const step of maintenanceSteps(root, python, npmCli)) {
      if (!report.steps.some(item => item.name === step.name)) report.steps.push({ name: step.name, status: 'not_run' })
    }
    report.finished_at = new Date().toISOString()
    report.status = !interrupted && report.steps.every(item => item.status === 'passed') ? 'passed' : 'failed'
    save()
    console.log('Maintenance ' + report.status + '. Report: ' + reportPath)
    if (report.status !== 'passed') process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
