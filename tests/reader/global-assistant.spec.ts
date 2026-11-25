import { test, expect } from '@playwright/test'
import path from 'node:path'
test('Global assistant entry is outside the PDF and preserves attached context',async({page},info)=>{
  await page.goto('/reader-workbench.html')
  const trigger=page.getByRole('button',{name:'AI 学习助手',exact:true})
  await expect(trigger).toBeVisible();expect(await trigger.evaluate(el=>el.closest('.reader-lab')===null)).toBe(true)
  await trigger.click();await expect(page.getByText('未连接 AI · 当前没有关联内容。')).toBeVisible();await page.getByRole('button',{name:'关闭面板',exact:true}).click();await expect(trigger).toBeFocused()
  await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(path.resolve('tests/fixtures/reader/mixed.pdf'));await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true')
  await expect(page.getByRole('button',{name:'向助手提问',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'框选',exact:true}).click();const r=(await page.locator('.rl-page').boundingBox())!;await page.mouse.move(r.x+r.width*.2,r.y+r.height*.2);await page.mouse.down();await page.mouse.move(r.x+r.width*.35,r.y+r.height*.3,{steps:5});await page.mouse.up();await page.getByRole('button',{name:'向助手提问',exact:true}).click()
  const panel=page.getByRole('complementary',{name:'全局学习助手',exact:true});expect(await panel.evaluate(el=>el.closest('.reader-lab')===null)).toBe(true)
  await page.getByLabel('问题草稿').fill('保留统一助手的问题');await page.getByRole('button',{name:'关闭面板',exact:true}).click();await expect(page.getByRole('button',{name:'向助手提问',exact:true})).toBeFocused()
  await page.getByRole('button',{name:'取消选区',exact:true}).click();await trigger.click();await expect(page.locator('blockquote')).toContainText('区域选择');await expect(page.getByLabel('问题草稿')).toHaveValue('保留统一助手的问题')
  await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.rl-page')).toHaveAttribute('data-page','2');await expect(page.locator('.rl-panel-body')).toContainText('页码：1')
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await trigger.click();await expect(page.getByLabel('问题草稿')).toHaveValue('保留统一助手的问题');await page.screenshot({path:info.outputPath('global-assistant.png')})
})
