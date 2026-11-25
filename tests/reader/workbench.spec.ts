import {test,expect} from '@playwright/test'
import path from 'node:path'
test('FE-V02 review layouts preserve document, notes and context',async({page},info)=>{
  const errors:string[]=[],calls:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))calls.push(r.url())})
  await page.goto('/reader-workbench.html?assistantDebug=1');await expect(page.getByText('学习工作台',{exact:true})).toBeVisible()
  await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles({name:'数据库系统原理_非常长的课件文件名称_第五章_阅读与批注设计评审样本.pdf',mimeType:'application/pdf',buffer:await import('node:fs').then(fs=>fs.readFileSync(path.resolve('tests/fixtures/reader/mixed.pdf')))})
  await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true')
  await page.getByLabel('缩放百分比',{exact:true}).fill('100');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true')
  for(const layout of ['顶部工具']){
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
    await page.screenshot({path:info.outputPath(layout.startsWith('A')?'a-reading.png':'b-reading.png')})
    await page.getByRole('button',{name:'AI 学习助手',exact:true}).click();await page.getByLabel('问题草稿').fill('草稿不会因布局切换丢失');await page.getByRole('button',{name:'演示解释',exact:true}).click();await expect(page.locator('.wb-example .katex')).toBeVisible()
    await expect(page.getByRole('button',{name:'关闭面板',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath(layout.startsWith('A')?'a-assistant.png':'b-assistant.png')});await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'AI 学习助手',exact:true})).toBeFocused();await expect(page.getByLabel('缩放百分比',{exact:true})).toHaveValue('100')
  }
  await page.getByRole('button',{name:'添加贴条',exact:true}).click();await page.getByLabel('贴条内容').fill('集中笔记测试：这里保存一条较长的中文说明，用来检查笔记列表换行与阅读位置。');await page.getByRole('button',{name:'阅读',exact:true}).click();await page.getByRole('button',{name:'收起贴条',exact:true}).click();await expect(page.locator('.rl-note')).toHaveClass(/collapsed/)
  await page.getByRole('button',{name:'笔记 1',exact:true}).click();await page.getByLabel('检索笔记').fill('不存在');await expect(page.getByText('未找到匹配笔记。',{exact:false})).toBeVisible();await page.getByRole('button',{name:'清除检索',exact:true}).click();await expect(page.locator('.wb-note-item')).toHaveCount(1)
  await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.rl-page')).toHaveAttribute('data-page','2');await page.locator('.wb-note-item').click();await expect(page.locator('.rl-page')).toHaveAttribute('data-page','1');await page.getByRole('button',{name:'展开贴条',exact:true}).click();await expect(page.getByLabel('贴条内容')).toHaveValue(/集中笔记测试/)
  await page.getByRole('button',{name:'收起导航',exact:true}).first().click();await expect(page.getByRole('complementary',{name:'资料导航',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'展开导航',exact:true}).click();await expect(page.getByTestId('save-status')).toHaveText('已保存');await page.screenshot({path:info.outputPath('notes.png')})
  await page.reload();await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(path.resolve('tests/fixtures/reader/mixed.pdf'));await expect(page.getByLabel('贴条内容')).toHaveValue(/集中笔记测试/);expect(errors).toEqual([]);expect(calls).toEqual([])
})
