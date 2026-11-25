import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
const directory=path.resolve(process.argv[2] || '')
if(!process.argv[2] || !path.basename(directory).startsWith('acceptance-reader-')) throw new Error('Explicit unique acceptance folder required')
mkdirSync(directory,{recursive:true})
const hash=f=>createHash('sha256').update(readFileSync(f)).digest('hex')
const doc={id:'example-sha256',name:'public-sample.pdf',originalFormat:'pdf',previewFormat:'pdf',previewVersion:'pdfjs-6.5.438-normalized-v1',pages:[{width:800,height:600},{width:600,height:800}]}
const anchor={documentId:doc.id,previewVersion:doc.previewVersion,page:1,space:'normalized-top-left',regions:[{x:.2,y:.3,width:.25,height:.15}],text:'公开选文',precision:'text'}
const reader={page:1,zoom:'fit',scroll:{x:0,y:0},selection:anchor,panelOpen:true,draft:'请解释这段',context:anchor}
const example={schema:1,document:doc,annotations:[{id:'note-example',schema:1,kind:'note',text:'公开自制笔记',updatedAt:'2026-11-23T02:00:00Z',anchor},{id:'highlight-example',schema:1,kind:'highlight',color:'#ffe04a',updatedAt:'2026-11-23T02:00:00Z',anchor},{id:'ink-example',schema:1,kind:'ink',color:'#215cbd',width:2,points:[{x:.2,y:.3},{x:.3,y:.35}],updatedAt:'2026-11-23T02:00:00Z',anchor}],reader,savedAt:'2026-11-23T02:00:00Z',fixtureReferenceExample:{fixture:true,label:'固定引用',target:{...anchor,page:2},returnState:reader}}
writeFileSync(path.join(directory,'FE-V01_脱敏样例.json'),JSON.stringify(example,null,2)+'\n')
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim()
const files=git(['ls-files','-co','--exclude-standard']).split('\n').filter(f=>f.startsWith('src/reader/')||f.startsWith('tests/reader/')||f.startsWith('tests/fixtures/reader/')||f.includes('reader')&&f.startsWith('scripts/')||['reader-lab.html','playwright.reader.config.ts','package.json','package-lock.json','vite.config.ts'].includes(f))
const fingerprint=Object.fromEntries(files.map(f=>[f,hash(f)]))
const statuses=['partial','partial','partial','passed','partial','partial','partial','partial','partial','passed','partial','partial','partial','partial','partial','partial','passed']
const report={status:'partial-verification-awaiting-acceptance',date:'2026-11-23',baseline:git(['rev-parse','HEAD']),branch:git(['branch','--show-current']),worktree:git(['status','--porcelain']),node:process.version,os:{release:os.release(),arch:os.arch(),cpus:os.cpus()[0]?.model,ram:os.totalmem()},sourceFingerprint:fingerprint,cases:statuses.map((status,i)=>({id:'A'+String(i+1).padStart(2,'0'),status,details:'See docs/archive/20261124/实施验收与复核/FE-V01_开发与验收报告.md; partial cases retain unexecuted requirements.'})),requiredRemaining:['real browser zoom 125%','ink/note point precision matrix','complete blur/history/keyboard cases','independent S1 fidelity review','standard cold/hot benchmark and 100ms ink feedback'],commands:['npm run test:reader','npm run test:maintenance','git diff --check']}
writeFileSync(path.join(directory,'acceptance.json'),JSON.stringify(report,null,2)+'\n')
for(const name of ['fe-v01-boardui-installation.html','fe-v01-boardui-button.json','fe-v01-boardui-license.html','fe-v01-boardui-terms.html']) {try{copyFileSync(path.join(os.tmpdir(),name),path.join(directory,name))}catch{}}
console.log(JSON.stringify({files:files.length,report:path.join(directory,'acceptance.json')}))
