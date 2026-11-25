import {chromium,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
const f=JSON.parse(readFileSync('data/acceptance-fev09/review-server.json','utf8'));
const browser=await chromium.launch({channel:'msedge'});try{const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto('http://127.0.0.1:7201/#/courses/'+f.course_id+'/reader?source='+f.source_id);await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true');await page.getByRole('button',{name:'AI 学习助手',exact:true}).click();await page.screenshot({path:'data/acceptance-fev09/baseline-same-course-1440.png'});}finally{await browser.close()}
