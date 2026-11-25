import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('..', import.meta.url))
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  const target = path.join(root, 'public/reader-assets', folder)
  mkdirSync(target, { recursive: true })
  for (const file of readdirSync(path.join(root, 'node_modules/pdfjs-dist', folder))) {
    copyFileSync(path.join(root, 'node_modules/pdfjs-dist', folder, file), path.join(target, file))
  }
}
console.log('Prepared local PDF.js CMaps, fonts and WASM; no external preview service.')
