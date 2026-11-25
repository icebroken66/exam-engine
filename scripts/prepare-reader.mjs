import './reader-assets.mjs'
import { spawnSync } from 'node:child_process'
const result = spawnSync(process.execPath, ['node_modules/@tailwindcss/cli/dist/index.mjs', '-i', 'src/reader/boardui/input.css', '-o', 'src/reader/boardui.generated.css', '--minify'], { stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
