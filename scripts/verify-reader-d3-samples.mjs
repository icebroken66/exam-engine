import {chromium,expect} from '@playwright/test'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
const directory=path.resolve(process.argv[2]||'')
if(!process.argv[2]||!path.basename(directory).startsWith('acceptance-reader-'))throw new Error('Explicit unique acceptance folder required')
mkdirSync(directory,{recursive:true})
const sources=path.resolve('data/acceptance-reader-20261123-matrix02')
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex')
const report=[]
for(const channel of ['msedge','chrome']){
  const browser=await chromium.launch({channel})
  try{
    for(const viewport of [{width:1024,height:768},{width:1440,height:900},{width:1920,height:1080}]){
      const page=await browser.newPage({viewport}),errors=[]
      page.on('pageerror',e=>errors.push(e.message))
      const entry={channel,version:browser.version(),viewport,errors,files:[]}
      for(const file of ['real-course.pdf','pptx-preview.pdf']){
        const source=path.join(sources,file),before=hash(source)
        await page.goto('http://127.0.0.1:7183/reader-workbench.html')
        await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(source)
        await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true')
        const prefix=channel+'-'+viewport.width+'-'+file
        await page.screenshot({path:path.join(directory,prefix+'-normal.png')})
        await page.getByRole('button',{name:'专注阅读',exact:true}).click()
        await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true')
        await page.screenshot({path:path.join(directory,prefix+'-focus.png')})
        await page.keyboard.press('Escape')
        const bounds=await page.evaluate(()=>{const r=document.querySelector('.rl-page').getBoundingClientRect(),v=document.querySelector('.rl-scroll').getBoundingClientRect();return{page:{width:r.width,height:r.height},area:{width:v.width,height:v.height},overflow:document.documentElement.scrollWidth>innerWidth}})
        expect(bounds.overflow).toBe(false)
        entry.files.push({file,before,after:hash(source),bounds})
      }
      expect(errors).toEqual([]);report.push(entry);await page.close()
    }
  }finally{await browser.close()}
}
writeFileSync(path.join(directory,'real-samples.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify({combinations:report.length,unchanged:report.every(r=>r.files.every(f=>f.before===f.after)),unhandledErrors:report.flatMap(r=>r.errors)}))
