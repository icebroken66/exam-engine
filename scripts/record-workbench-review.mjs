import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const directory=path.resolve(process.argv[2]||'')
if(!process.argv[2]||!path.basename(directory).startsWith('acceptance-reader-'))throw new Error('Explicit reader acceptance directory required')
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim()
const files=git(['ls-files','-co','--exclude-standard','-z']).split(String.fromCharCode(0)).filter(f=>f&&(f.startsWith('src/reader/')||f.startsWith('tests/reader/')||f.startsWith('scripts/')&&f.includes('reader')||['src/App.tsx','reader-workbench.html','reader-lab.html','package.json','package-lock.json','vite.config.ts','playwright.reader.config.ts','docs/archive/20261124/原始讨论与设计/旧学习页设计.md'].includes(f)))
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')]))
const report={task:'FE-V02',status:'design-review-awaiting-user-direction',head:git(['rev-parse','HEAD']),branch:git(['branch','--show-current']),worktree:git(['status','--porcelain']),sourceFingerprint:hashes,review:{recommended:'a',confirmed:null,userFeedback:null},engineering:{workbenchReview:JSON.parse(readFileSync(path.join(directory,'playwright.json'),'utf8')).stats,maintenance:JSON.parse(readFileSync(path.join(directory,'maintenance/report.json'),'utf8')).status,precisionRun:'data/acceptance-reader-20261123-fev02-precision-final',realBlurRun:'data/acceptance-reader-20261123-fev02-prerequisite-blur01'},cases:Array.from({length:16},(_,i)=>({id:'B'+String(i+1).padStart(2,'0'),status:i===5?'passed-public-fixture':i===11||i===13?'not-complete':i===15?'awaiting-user-feedback':'partial',details:'docs/archive/20261124/实施验收与复核/FE-V02_设计评审与实施报告.md'})),prerequisite:'FE-V01 remains partial: true browser zoom 125% and independent fidelity review still pending',entry:'http://127.0.0.1:7175/reader-workbench.html'}
writeFileSync(path.join(directory,'workbench-review.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify({files:files.length,status:report.status,maintenance:report.engineering.maintenance}))
