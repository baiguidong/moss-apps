import fs from 'node:fs/promises';
import path from 'node:path';
import { extraRecipes, openMoreView, resourceCheck } from './extra-recipes.mjs';
import { extendedRecipes } from './extended-recipes.mjs';

// These programs perform public UI actions and read the rendered result. They do
// not call IPC, internal stores, model APIs, or the result-recording endpoint.
const recipes = {
  ...extraRecipes,
  ...extendedRecipes,
  'settings-navigation': async ({ page, settings, shot, check, input }) => {
    await settings();
    for (const [id, title, sections] of [
      ['basic', '通用', ['基本信息', '模型', '网页搜索', '外观']],
      ['agents', 'Agents', ['Agents']],
      ['tools', '工具', ['Moss 内置工具', 'App 提供的工具']],
      ['advanced', '高级设置', ['权限', '记忆', 'Agent 与执行', '工具与性能', '系统提示', '服务地址']],
    ]) {
      const nav = page.locator('[data-settings-nav="' + id + '"]:visible');
      await nav.click();
      const heading = page.getByRole('heading', { name: title, level: 1, exact: true });
      await heading.waitFor();
      check(await nav.getAttribute('aria-current') === 'page', title + '导航未选中');
      for (const section of sections) await page.getByRole('heading', { name: section, level: id === 'tools' ? 3 : 2, exact: true }).waitFor();
      await shot(id);
    }
    await page.locator('[data-settings-nav="tools"]:visible').click();
    const builtin = page.getByRole('table').first();
    await builtin.getByRole('radio', { name: 'moss_browser_open 常驻', exact: true }).waitFor();
    check(await builtin.getByRole('row').count() > 1, '内置工具列表未加载');
    const expand = builtin.getByRole('button', { name: /^展开 .+ 的说明$/ }).first();
    if (await expand.count()) {
      await expand.click();
      const collapse = builtin.getByRole('button', { name: /^收起 .+ 的说明$/ }).first();
      check(await collapse.getAttribute('aria-expanded') === 'true', '工具说明未展开');
      await shot('tool-description', collapse.locator('../..'));
      await collapse.click();
    } else await shot('tools', builtin);
    const appTools = page.getByRole('table', { name: 'App 提供的工具', exact: true });
    if (await appTools.count()) {
      await page.waitForFunction(() => !Array.from(document.querySelectorAll('table[aria-label="App 提供的工具"] [role="status"]')).some(node => node.textContent.includes('正在加载')),
        undefined, { timeout: 5000 }).catch(() => {});
      const loading = await appTools.locator('tbody').evaluateAll(groups => groups.filter(group => Array.from(group.querySelectorAll('[role="status"]')).some(node => node.textContent.includes('正在加载'))).map(group => group.querySelector('th')?.innerText.slice(0, 180)));
      if (loading.length) {
        const groups = appTools.locator('tbody').filter({ has: page.getByRole('status').filter({ hasText: '正在加载' }) });
        for (let index = 0; index < await groups.count(); index++) await shot('service-loading-' + index, groups.nth(index));
      }
      // This is a settings navigation check. A first-use Python MCP may still
      // be preparing; retain its visible loading state as evidence, while a
      // service error remains a failure below.
      if (loading.length) check(await appTools.getByRole('status').count() > 0, 'App 工具加载中缺少状态提示');
      const errors = await appTools.locator('tbody').evaluateAll(groups => groups
        .filter(group => group.querySelector('[role="alert"]'))
        .map(group => ({ service: group.querySelector('th code')?.textContent,
          errors: Array.from(group.querySelectorAll('[role="alert"]'), node => node.textContent) })));
      if (errors.length) {
        const groups = appTools.locator('tbody').filter({ has: page.getByRole('alert') });
        for (let index = 0; index < await groups.count(); index++) await shot('service-error-' + index, groups.nth(index));
        check(false, 'App 工具加载错误（复核必须逐一确认这些服务已恢复）：' + JSON.stringify(errors));
      }
      check(await appTools.getByRole('row').count() > 1, 'App 工具列表为空');
      const appExpand = appTools.getByRole('button', { name: /^展开 .+ 的说明$/ }).first();
      if (await appExpand.count()) {
        await appExpand.click();
        const appCollapse = appTools.getByRole('button', { name: /^收起 .+ 的说明$/ }).first();
        check(await appCollapse.getAttribute('aria-expanded') === 'true', 'App 工具说明未展开');
        await shot('app-description', appCollapse.locator('../..'));
        await appCollapse.click();
      }
      await shot('app-tools', appTools);
    } else await page.getByText('已启用的 App 暂未提供 AI 工具。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    await input().waitFor();
    return ['通用、Agents、工具、高级设置的导航选中状态和各分区标题均匹配，已保存标题截图。', '内置工具及加载选项实际可见，已检查工具说明、App 工具条目或明确加载状态；返回新会话后输入区可用。'];
  },
  'runtime-settings': async ({ page, settings, shot, check }) => {
    const open = async () => { await settings(); await page.locator('[data-settings-nav="advanced"]:visible').click(); };
    const row = name => page.getByText(name, { exact: true }).locator('../..');
    const names = ['最大轮次', '单轮工具结果上限'];
    const fields = names.map(name => row(name).getByRole('spinbutton'));
    const originals = [], updated = [];
    await open();
    const protection = page.getByRole('checkbox', { name: '大型工具结果保护', exact: true });
    const protectedBefore = await protection.isChecked();
    try {
      if (!protectedBefore) await protection.locator('..').click();
      for (const field of fields) {
        const before = await field.inputValue(); originals.push(before);
        const after = String(Number(before) < Number(await field.getAttribute('max')) ? Number(before) + 1 : Number(before) - 1);
        await field.fill(after); await field.press('Tab'); updated.push(after);
      }
      await page.getByRole('button', { name: '新会话', exact: true }).click(); await open();
      for (let i = 0; i < fields.length; i++) {
        check(await fields[i].inputValue() === updated[i], names[i] + '未保存');
        await shot('saved-' + i, row(names[i]));
      }
      for (const name of ['会话运行时空闲回收', '最多保留会话运行时', 'MCP 服务空闲回收']) {
        const value = page.getByRole('spinbutton', { name, exact: true });
        check(await value.isVisible() && Number.isFinite(Number(await value.inputValue())), name + '未正确显示');
        await shot(name, row(name));
      }
    } finally {
      for (let i = 0; i < originals.length; i++) { await fields[i].fill(originals[i]); await fields[i].press('Tab'); }
      if (await protection.isChecked() !== protectedBefore) await protection.locator('..').click();
    }
    await page.getByRole('button', { name: '新会话', exact: true }).click(); await open();
    for (let i = 0; i < originals.length; i++) check(await fields[i].inputValue() === originals[i], names[i] + '未恢复');
    check(await protection.isChecked() === protectedBefore, '大型工具结果保护未恢复');
    return ['最大轮次、单轮工具结果上限修改后重新打开均保留；恢复后再次打开核对原值一致。', '会话运行时空闲回收、最多保留会话运行时、MCP 服务空闲回收均显示有效数值，设置页正常加载。'];
  },
  'memory-settings': async ({ page, settings, shot, check }) => {
    const open = async () => { await settings(); await page.locator('[data-settings-nav="advanced"]:visible').click(); };
    const names = ['历史上下文搜索', '从纠正中学习'];
    const controls = names.map(name => page.getByRole('checkbox', { name, exact: true }));
    const originals = [];
    await open();
    try {
      for (const control of controls) { originals.push(await control.isChecked()); await control.locator('..').click(); }
      await page.getByRole('button', { name: '新会话', exact: true }).click(); await open();
      for (let i = 0; i < controls.length; i++) {
        check(await controls[i].isChecked() === !originals[i], names[i] + '未保存');
        await shot('saved-' + i, page.getByText(names[i], { exact: true }).locator('../..'));
      }
      const strategy = page.getByText('上下文压缩策略', { exact: true }).locator('../..').getByRole('combobox');
      check(['proactive', 'reactive'].includes(await strategy.inputValue()), '上下文压缩策略无效');
      for (const name of ['会话摘要', '长期记忆']) {
        const control = page.getByRole('checkbox', { name, exact: true });
        check(await control.count() === 1, name + '配置缺失');
        await shot(name, control.locator('../../../..'));
      }
      await shot('strategy', strategy.locator('../..'));
    } finally {
      for (let i = 0; i < originals.length; i++) if (await controls[i].isChecked() !== originals[i]) await controls[i].locator('..').click();
    }
    await page.getByRole('button', { name: '新会话', exact: true }).click(); await open();
    for (let i = 0; i < originals.length; i++) check(await controls[i].isChecked() === originals[i], names[i] + '未恢复');
    return ['历史上下文搜索、从纠正中学习均切换并重新打开验证保存；恢复后再次打开核对原状态一致。', '上下文压缩策略为有效选项，会话摘要及长期记忆配置存在；未触发模型整理。'];
  },
  startup: async ({ page, shot, check, input, settings }) => {
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    await input().waitFor();
    check(await input().isVisible(), '新会话输入区域不可见');
    await shot('main');
    await settings();
    await shot('settings');
    return ['主界面、新会话入口和输入区域可见，未出现白屏。', '已点击新会话与设置，设置页“通用”标题实际可见。'];
  },
  appearance: async ({ page, shot, check, settings }) => {
    await settings();
    for (const [name, theme] of [['浅色', 'light'], ['暗色', 'dark']]) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
      await page.locator('section#appearance').evaluate(node => node.scrollIntoView({ block: 'start' }));
      await shot(theme);
    }
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    await settings();
    check(await page.locator('html').getAttribute('data-theme') === 'dark', '重新打开设置后暗色主题未保留');
    await page.locator('section#appearance').evaluate(node => node.scrollIntoView({ block: 'start' }));
    await shot('reopened');
    return ['通过主题按钮切换浅色和暗色，实际页面主题随之改变，已分别截图供视觉核对。', '离开设置再重新打开后，页面仍使用刚才保存的暗色主题。'];
  },
  'apps-list': async ({ page, shot, check, input, expectedApps }) => {
    await page.getByRole('button', { name: /^Apps \d+$/ }).click();
    const panel = page.getByRole('tabpanel');
    await panel.waitFor();
    // Earlier cases may leave the persistent App discovery section on Online.
    await page.getByRole('combobox', { name: '应用分区' }).selectOption('all');
    await page.getByRole('textbox', { name: '搜索应用' }).fill('');
    await page.getByRole('tab').first().click();
    const cards = panel.locator('section[data-app-category]');
    const observed = await cards.evaluateAll(nodes => nodes.map(node => ({
      name: node.querySelector('h3')?.textContent,
      enabled: node.querySelector('input[role="switch"]')?.checked,
    })));
    check(observed.length === expectedApps.length, `已安装数量不一致：界面 ${observed.length}，继承清单 ${expectedApps.length}`);
    for (const expected of expectedApps) {
      const matches = observed.filter(item => item.name === expected.name);
      check(matches.length === 1 && matches[0].enabled === expected.enabled, `应用缺失、重名或启用状态不一致：${expected.name}`);
    }
    await shot('all');
    const tabs = page.getByRole('tab');
    const categories = [];
    for (let index = 1; index < Math.min(await tabs.count(), 3); index++) {
      const tab = tabs.nth(index);
      await tab.click();
      check(await tab.getAttribute('aria-selected') === 'true', '分类页签未选中');
      const values = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-app-category')));
      const label = await tab.innerText();
      check(values.length > 0 && new Set(values).size === 1, `分类混入其他应用：${label}`);
      const count = Number(label.trim().match(/\d+$/)?.[0]);
      check(count === values.length, `分类数量不一致：${label}`);
      categories.push(`${label.replace(/\s+/g, ' ')}：${values.length} 个`);
      await shot(`category-${index}`);
    }
    if (await tabs.count()) await tabs.first().click();
    check(await cards.count() === expectedApps.length, '返回全部后数量不一致');
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    await input().waitFor();
    return [`已核对 ${observed.length} 个已安装 App 的名称和启用状态，与本轮继承清单一致。`, `分类检查：${categories.join('；') || '空安装环境'}；返回全部后数量恢复，已回到可操作的聊天界面。`];
  },
  'file-preview': async ({ page, fixture, shot, input, openPreview }) => {
    await fixture();
    const file = page.locator('span[title="self-test-note.txt"]');
    await file.waitFor();
    const preview = await openPreview(() => file.dblclick());
    try {
      await preview.getByText('Moss self-test fixture', { exact: false }).waitFor({ timeout: 5000 });
      await shot('content', preview);
    } finally { await preview.close(); }
    // Closing an inline preview can restore the Results tab. Reopen Workspace
    // before asserting that its file list remains available.
    const workspaceTab = page.getByRole('button', { name: '工作区', exact: true });
    if (await workspaceTab.isVisible()) await workspaceTab.click();
    await file.waitFor();
    await input().waitFor();
    await shot('closed');
    return ['工作区列表显示 self-test-note.txt，打开的预览窗口实际包含 Moss self-test fixture。', '关闭预览后，原文件列表与聊天输入区域仍可见。'];
  },
  'chat-response': async ({ page, shot, send, reopen, input, marker }) => {
    const chat = await send('chat', 'MOSS_SELF_TEST_OK');
    await shot('reply');
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    await input().waitFor();
    await reopen(chat);
    await shot('reopened');
    return [`已真实发送 ${marker}-chat，assistant 消息中收到 MOSS_SELF_TEST_OK。`, '回复结束后发送入口恢复；离开再回到会话，用户消息和 assistant 回复都保留。'];
  },
  'session-switch': async ({ shot, send, reopen, marker }) => {
    const a = await send('A', 'MOSS_SESSION_A_OK');
    const b = await send('B', 'MOSS_SESSION_B_OK');
    await reopen(a, b.token); await shot('A');
    await reopen(b, a.token); await shot('B');
    return [`本轮 ${marker}-A、${marker}-B 两个独立会话分别收到真实 assistant 回复 MOSS_SESSION_A_OK 和 MOSS_SESSION_B_OK。`, '已通过侧栏依次切回 A、B；双方用户消息和回复保留，未混入另一会话的标记。'];
  },
  'session-info': async ({ page, fixture, shot, check, input }) => {
    await fixture();
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: '查看会话信息', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '会话信息', exact: true });
      await dialog.getByRole('heading', { name: '基本信息', exact: true }).waitFor();
      for (const title of ['Token 用量', '工具调用', '任务与资源']) await dialog.getByRole('heading', { name: title, exact: true }).waitFor();
      const text = await dialog.innerText();
      check(text.includes('self-test-workspace') && !text.includes('NaN'), '会话工作区或统计不正确');
      await shot('info-' + attempt, dialog);
      if (attempt === 0) {
        await dialog.getByRole('heading', { name: '任务与资源', exact: true }).evaluate(node => node.scrollIntoView({ block: 'end' }));
        await shot('resources', dialog);
      }
      await page.getByRole('button', { name: '关闭会话信息', exact: true }).click();
    }
    await input().waitFor();
    return ['会话信息显示样例工作区、Token、工具和资源分区，无 NaN；截图供核对具体统计值。', '已关闭并重新打开同一会话的信息，最后恢复到可输入状态。'];
  },
  'session-search': async ({ page, shot, fixture, input, marker }) => {
    await fixture();
    await page.getByRole('button', { name: '搜索所有消息', exact: true }).click();
    const search = page.getByPlaceholder('搜索所有会话的标题与消息正文');
    await search.fill('自测样例');
    const dialog = search.locator('../..');
    const match = dialog.getByRole('button').filter({ hasText: '自测样例' }).first();
    await match.waitFor(); await shot('results', dialog); await match.click();
    await page.getByRole('button', { name: '查看会话信息', exact: true }).waitFor();
    await shot('match');
    await page.getByRole('button', { name: '搜索所有消息', exact: true }).click();
    await search.fill('MOSS_NO_SESSION_' + marker);
    await page.getByText('没有找到匹配消息', { exact: true }).waitFor();
    await shot('empty');
    await search.fill('');
    await page.getByText('输入关键词搜索所有可见会话', { exact: true }).waitFor();
    await shot('cleared', dialog);
    await page.getByRole('button', { name: '关闭搜索', exact: true }).click();
    await input().waitFor();
    await shot('closed');
    return ['全局搜索命中“自测样例”，点击后打开可查看信息的会话。', '不存在的标记显示无结果；清空恢复搜索提示，关闭后输入区可用。'];
  },
  'chat-appearance': async ({ page, settings, shot, check }) => {
    await settings();
    const labels = ['聊天字体大小', '聊天行间距', '聊天消息间距'], originals = [], updated = [];
    const sliders = labels.map(label => page.getByRole('slider', { name: label, exact: true }));
    const preview = page.getByLabel('消息外观预览', { exact: true });
    const capture = async name => {
      await preview.evaluate(node => node.scrollIntoView({ block: 'end' }));
      await preview.getByText('这是一条 AI 回复预览。', { exact: false }).waitFor();
      await shot(name);
    };
    try {
      for (const slider of sliders) {
        const before = Number(await slider.getAttribute('aria-valuenow'));
        originals.push(before);
        await slider.press(before < Number(await slider.getAttribute('aria-valuemax')) ? 'ArrowRight' : 'ArrowLeft');
        const after = Number(await slider.getAttribute('aria-valuenow'));
        check(after !== before, '滑块没有改变数值'); updated.push(after);
      }
      await capture('changed');
      await page.getByRole('button', { name: '新会话', exact: true }).click(); await settings();
      for (let i = 0; i < sliders.length; i++) check(Number(await sliders[i].getAttribute('aria-valuenow')) === updated[i], labels[i] + '未保存');
      await capture('persisted');
    } finally {
      for (let i = 0; i < originals.length; i++) {
        const current = Number(await sliders[i].getAttribute('aria-valuenow'));
        if (current !== originals[i]) await sliders[i].press(current > originals[i] ? 'ArrowLeft' : 'ArrowRight');
        check(Number(await sliders[i].getAttribute('aria-valuenow')) === originals[i], labels[i] + '未恢复');
      }
    }
    return ['三个外观滑块均通过键盘修改为 ' + updated.join('、') + '，已保存真实消息预览和滑块截图供核对可读性。', '离开后重新打开，三个修改值保留，随后逐个恢复原值。'];
  },
  'project-create': async ({ page, shot, check, marker }) => {
    const name = 'project-' + marker.split(' ')[1].slice(0, 8), rule = 'PROJECT_RULE_' + marker.split(' ')[1].slice(0, 8);
    await page.getByRole('button', { name: '项目', exact: true }).click();
    const back = page.getByRole('button', { name: '项目 / 返回列表', exact: true });
    if (await back.isVisible()) await back.click();
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByPlaceholder('项目', { exact: true }).fill(name);
    await page.getByPlaceholder('写入项目长期约束、偏好、交付标准或背景信息').fill(rule);
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await shot('created');
    await back.click();
    const search = page.getByPlaceholder('搜索项目'); await search.fill(name);
    await page.getByRole('button').filter({ hasText: name }).first().click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    const expand = page.getByRole('button', { name: '在右侧展开项目配置', exact: true });
    if (await expand.isVisible()) await expand.click();
    check(await page.getByText(rule, { exact: true }).count() > 0 || await page.locator('textarea').evaluateAll((nodes, expected) => nodes.some(node => node.value === expected), rule), '项目指令未保存');
    await shot('reopened');
    await back.click(); await search.fill('NO_PROJECT_' + name);
    check(await page.getByRole('button').filter({ hasText: name }).count() === 0, '无匹配搜索仍显示本轮项目');
    await shot('empty'); await search.fill('');
    await page.getByRole('button').filter({ hasText: name }).first().waitFor();
    return ['通过创建表单新增本轮项目，并通过名称搜索重新打开。', '重新打开后指令保留，无匹配搜索排除本轮项目，清空后恢复。'];
  },
  'workspace-version': async ({ page, fixture, shot, marker, check }) => {
    await fixture();
    await page.waitForFunction(() => {
      const refresh = document.querySelector('button[aria-label="刷新工作区"]');
      return refresh && !refresh.disabled;
    });
    const history = page.getByRole('button', { name: '历史版本', exact: true });
    const dialog = page.getByRole('dialog', { name: '历史版本', exact: true });
    const versions = dialog.getByRole('button').filter({ hasText: '个文件改动' });
    let previous = 0;
    if (await history.isEnabled()) {
      await history.click(); await versions.first().waitFor(); previous = await versions.count();
      await page.getByRole('button', { name: '返回当前工作区', exact: true }).click();
    }
    await page.getByRole('button', { name: '保存版本', exact: true }).click();
    const label = 'v-' + marker.split(' ')[1].slice(0, 8);
    await page.getByRole('textbox', { name: '版本', exact: true }).fill(label);
    await page.getByRole('button', { name: '确认保存版本', exact: true }).click();
    const notice = page.getByRole('status').filter({ hasText: /已保存版本|没有文件变化，无需保存版本/ });
    await notice.waitFor();
    const unchanged = (await notice.innerText()).includes('没有文件变化');
    await shot('saved', notice);
    await history.click();
    await versions.first().waitFor();
    if (unchanged) {
      check(previous > 0 && await versions.count() === previous, '无变化保存应保留原版本数量');
      await versions.first().click();
    } else {
      check(await versions.count() === previous + 1, '保存后没有新增版本');
      await versions.filter({ hasText: label }).click();
    }
    await page.getByRole('textbox', { name: '搜索版本文件', exact: true }).fill('self-test-note.txt');
    await page.getByRole('button', { name: 'self-test-note.txt', exact: true }).click();
    await page.getByText('Moss self-test fixture', { exact: false }).waitFor();
    await shot('history');
    await page.getByRole('button', { name: '返回当前工作区', exact: true }).click();
    await page.getByRole('button', { name: '保存版本', exact: true }).waitFor();
    await shot('returned');
    return [unchanged ? '本次保存明确提示没有文件变化；已核对历史版本数量未增加，未把原版本当成本轮新建。' : '通过界面保存本轮版本，历史版本数量加一且包含本轮标签。', '历史文件检索命中样例文本，预览含 Moss self-test fixture，已返回当前工作区。'];
  },
  'preview-markdown': async ({ preview, check }) => {
    await preview('self-test-preview.md', async target => {
      await target.getByRole('heading', { name: 'Moss Preview', exact: true }).waitFor();
      check(await target.getByRole('cell', { name: '240', exact: true }).count() === 2, '表格数据不完整');
      await target.getByText('first', { exact: true }).waitFor();
      await target.getByText('preview-ok', { exact: false }).waitFor();
    });
    return ['Markdown 预览显示标题、两行 240 表格、列表与代码标记。', '已保存预览截图并关闭，原工作区和输入区可用。'];
  },
  'preview-html': async ({ preview, check }) => {
    await preview('self-test-preview.html', async target => {
      const frame = target.frameLocator('iframe').first();
      await frame.getByRole('heading', { name: 'MOSS_HTML_PREVIEW', exact: true }).waitFor();
      await frame.getByText('订单总额 580', { exact: true }).waitFor();
      check(true, 'HTML 已渲染');
    });
    return ['HTML iframe 实际显示标题 MOSS_HTML_PREVIEW 与订单总额 580。', '预览已关闭，原工作区与输入区正常。'];
  },
  'preview-csv': async ({ preview, check }) => {
    await preview('self-test-data.csv', async target => {
      await target.getByText('product', { exact: true }).waitFor();
      const rows = await target.locator('tr').evaluateAll(nodes => nodes.map(row => Array.from(row.querySelectorAll('th,td'), cell => cell.textContent.trim())));
      const expected = [['product', 'price', 'quantity', 'total'], ['A', '120', '2', '240'], ['B', '80', '3', '240'], ['C', '50', '2', '100']];
      check(JSON.stringify(rows) === JSON.stringify(expected), 'CSV 行列或数据与样例不一致：' + JSON.stringify(rows));
    });
    return ['CSV 表头及 A/B/C 三行的每个单元格均与样例匹配，已截图供核对列位置。', '字段可读，关闭后原工作区与输入区正常。'];
  },
  'preview-code': async ({ preview }) => {
    await preview('self-test-data.json', async target => {
      await target.getByText('MOSS_JSON_PREVIEW', { exact: false }).waitFor();
      await target.getByText('580', { exact: false }).waitFor();
    });
    await preview('self-test-code.js', async target => { await target.getByText('MOSS_CODE_PREVIEW', { exact: false }).waitFor(); });
    return ['JSON 预览包含 MOSS_JSON_PREVIEW 和总额 580。', 'JavaScript 预览显示 MOSS_CODE_PREVIEW，已保存两种格式的截图并关闭。'];
  },
};

export const scriptedCaseIds = Object.keys(recipes);
export function buildUiRecipe(caseId, run, expectedApps = []) {
  if (!recipes[caseId]) return null;
  // Arrow functions remain valid expressions after bundlers rename bindings.
  const fn = recipes[caseId].toString();
  return `async (initialPage, helpers = {}) => {
    const options = ${JSON.stringify({ caseId, targetId: run.targetId, evidenceDir: run.evidenceDir, fixturePath: run.fixturePath, marker: `自测 ${run.id.slice(0, 8)}-${caseId}`, expectedApps })};
    const page = initialPage.context().pages().find(candidate => candidate.url().includes('moss-self-test=' + options.targetId));
    if (!page) throw new Error('未找到本轮测试主页面，请列出页面后重新选择。');
    page.setDefaultTimeout(5000);
    const evidence = [], started = Date.now();
    await page.keyboard.press('Escape');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const input = () => page.getByRole('textbox').first();
    const more = name => (${openMoreView.toString()})(page, name);
    const resource = label => (${resourceCheck.toString()})({ page, shot, check, marker: options.marker }, label);
    const shot = async (name, target = page) => {
      const base = options.evidenceDir + '/' + options.caseId + '-' + name;
      let filename = base + '.png', suffix = 2;
      while (evidence.includes(filename)) filename = base + '-' + suffix++ + '.png';
      await target.screenshot({ path: filename, animations: 'disabled', scale: 'css' }); evidence.push(filename);
    };
    const settings = async () => {
      await page.getByRole('button', { name: '设置', exact: true })
        .and(page.locator('button:not([data-app-settings])')).click();
      await page.locator('[data-settings-nav="basic"]:visible').click();
      await page.getByRole('heading', { name: '通用', exact: true, level: 1 }).waitFor();
    };
    const fixture = async () => {
      await page.getByRole('button', { name: '新会话', exact: true }).click();
      const all = page.getByRole('button', { name: '全部', exact: true });
      if (await all.isVisible()) await all.click();
      await page.getByRole('button', { name: /^本地会话 自测样例/ }).click();
      await page.getByRole('button', { name: '查看会话信息', exact: true }).waitFor();
      const expand = page.getByRole('button', { name: '展开右侧栏', exact: true });
      if (await expand.isVisible()) await expand.click();
      const workspaceTab = page.getByRole('button', { name: '工作区', exact: true });
      if (await workspaceTab.isVisible()) await workspaceTab.click();
      await page.locator('span[title="self-test-note.txt"]').waitFor();
    };
    const openPreview = async trigger => {
      const existing = page.context().pages().find(candidate => new URL(candidate.url()).searchParams.get('window') === 'preview');
      if (existing) { await trigger(); return existing; }
      await trigger();
      const popup = page.context().pages().find(candidate => candidate !== page && new URL(candidate.url()).searchParams.get('window') === 'preview');
      if (popup) return popup;
      // Current workspace files open in the right-hand inline preview.
      const close = page.getByRole('button', { name: '关闭预览窗口', exact: true });
      await close.waitFor({ timeout: 5000 });
      return new Proxy(page, { get(target, key) {
        if (key === 'close') return () => close.click();
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    const preview = async (name, verify) => {
      await fixture();
      const file = page.locator('span[title="' + name + '"]');
      const target = await openPreview(() => file.dblclick());
      try { await verify(target); await shot(name, target); }
      finally { await target.close(); }
      const workspaceTab = page.getByRole('button', { name: '工作区', exact: true });
      if (await workspaceTab.isVisible()) await workspaceTab.click();
      await file.waitFor(); await input().waitFor();
      await shot(name + '-closed');
    };
    const send = async (label, token) => {
      await page.getByRole('button', { name: '新会话', exact: true }).click();
      await input().waitFor(); await input().fill(options.marker + '-' + label + '，请只回复 ' + token + '。');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      const reply = page.locator('[data-message-body="assistant"]').filter({ hasText: token });
      await reply.waitFor({ state: 'visible', timeout: 45000 });
      await page.getByRole('button', { name: '发送', exact: true }).waitFor({ state: 'visible', timeout: 45000 });
      check((await reply.innerText()).includes(token), '未读到真实 assistant 回复');
      return { label, token, title: options.marker + '-' + label };
    };
    const reopen = async (chat, otherToken) => {
      const row = page.getByRole('button', { name: /^本地会话 / }).filter({ hasText: chat.title });
      check(await row.count() === 1, '测试会话定位缺失或不唯一，不能任取第一项');
      await row.click();
      await page.locator('[data-message-body="assistant"]').filter({ hasText: chat.token }).waitFor();
      const text = (await page.locator('[data-message-body="assistant"]').allInnerTexts()).join('\\n');
      check(!otherToken || !text.includes(otherToken), '会话混入另一会话的回复');
      check((await page.locator('[data-message-body="user"]').innerText()).includes(chat.title), '用户消息未保留');
      await input().waitFor();
    };
    try {
      // A previous diagnostic may have opened a floating App widget. Restore a
      // usable baseline via its public collapse button, without hiding DOM or
      // force-clicking through an overlay. Failure to collapse remains visible.
      for (const widget of await page.locator('aside[data-expanded="true"][aria-label$="桌面挂件"]').all()) {
        await widget.getByRole('button', { name: '收起', exact: true }).click();
        await widget.waitFor({ state: 'hidden' });
      }
      const observations = await (${fn})({ page, shot, check, input, settings, fixture, preview, openPreview, send, reopen, more, resource, evidence, nativePdf: helpers.nativePdf, appWebview: helpers.appWebview, fixturePath: options.fixturePath, marker: options.marker, expectedApps: options.expectedApps });
      return { caseId: options.caseId, checks: observations.map((actual, index) => ({ index, passed: true, actual })), evidence, durationMs: Date.now() - started };
    } catch (error) {
      // Preserve the failure and any partial evidence. The controller inspects
      // the page; it must not replay sends or convert a timeout into a pass.
      try { await shot('error'); } catch {}
      return { caseId: options.caseId, error: String(error.message || error).slice(0, 2400), evidence, durationMs: Date.now() - started, needsReview: true };
    }
  }`;
}

export async function prepareUiRecipes(run) {
  const supported = run.cases.filter(test => scriptedCaseIds.includes(test.id));
  if (!supported.length) return {};
  const expectedApps = [];
  let appNamesAvailable = true;
  if (supported.some(test => test.id === 'apps-list')) {
    try {
      for (const app of run.inheritedApps || []) {
        if (!/^[a-z0-9][a-z0-9._-]*$/.test(app.id) || !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(app.version)) throw new Error('继承应用标识无效。');
        const manifest = JSON.parse(await fs.readFile(path.join(run.home, 'apps', app.id, 'versions', app.version, 'app.moss.json'), 'utf8'));
        if (!manifest.displayName) throw new Error('应用显示名称缺失。');
        expectedApps.push({ id: app.id, name: manifest.displayName, enabled: Boolean(app.enabled) });
      }
    } catch {
      // A broken App is a useful test finding, not a reason to cancel all other
      // cases. Let the controller inspect the list without a prepared recipe.
      appNamesAvailable = false;
    }
  }
  const directory = path.join(run.directory, 'scripts');
  await fs.mkdir(directory, { recursive: true });
  const scripts = {};
  for (const test of supported) {
    if (test.id === 'apps-list' && !appNamesAvailable) continue;
    const file = path.join(directory, `${test.id}.js`);
    await fs.writeFile(file, buildUiRecipe(test.id, run, expectedApps), { mode: 0o600 });
    scripts[test.id] = file;
  }
  return scripts;
}
