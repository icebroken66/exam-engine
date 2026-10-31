import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const python = process.platform === 'win32'
  ? path.join(root, '.venv', 'Scripts', 'python.exe')
  : path.join(root, '.venv', 'bin', 'python')

if (!existsSync(python)) {
  console.error('未找到后端环境。请先运行 python -m venv .venv 并安装 backend[test]。')
  process.exit(1)
}

const children = []
let stopping = false

function launch(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options })
  children.push(child)
  child.on('exit', (code) => {
    if (!stopping && code && code !== 0) stop(code)
  })
  return child
}

function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 250).unref()
}

launch(python, [
  '-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend',
  '--host', '127.0.0.1', '--port', '8000', '--reload',
], { cwd: root })

launch(python, ['-m', 'app.worker'], { cwd: path.join(root, 'backend') })

launch(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), ...process.argv.slice(2)], { cwd: root })

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
