// Extended cases use the same real UI and independent evidence review as the
// default suite. No internal IPC or fabricated model replies.
export const extendedRecipes = {
  'browser-panel': async ({ page, fixture, input, shot, check }) => {
    await fixture();
    const browser = page.getByRole('button', { name: '浏览器', exact: true });
    const files = page.getByRole('button', { name: '工作区', exact: true });
    await browser.click();
    await page.getByRole('tablist', { name: '浏览器标签页', exact: true }).getByRole('tab').first().waitFor();
    const address = page.getByPlaceholder('网址或 localhost:3000', { exact: true });
    await address.fill('https://example.com'); await address.press('Enter');
    let target;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      target = page.context().pages().find(candidate => /^https:\/\/example\.com\/?$/.test(candidate.url()));
      if (target) break;
      await page.waitForTimeout(50);
    }
    check(Boolean(target), '未找到实际浏览器页面');
    // The public example page no longer has an h1; validate its document title
    // plus real rendered body, not a historical heading structure.
    await target.locator('body').filter({ hasText: /documentation examples|illustrative examples/i }).waitFor({ timeout: 30000 });
    await page.getByRole('tab', { name: 'Example Domain', exact: true }).waitFor();
    check(await target.title() === 'Example Domain', '实际浏览器文档标题不符');
    check((await address.inputValue()).includes('example.com'), '浏览器地址不符');
    await shot('page', target); await shot('address');
    await Promise.all([target.waitForEvent('load', { timeout: 30000 }), page.getByTitle('刷新', { exact: true }).click()]);
    await target.locator('body').filter({ hasText: /documentation examples|illustrative examples/i }).waitFor(); await shot('refreshed', target);
    // Exercise blank-tab initialization too. The next case reconnects to CDP,
    // which used to hang when a native blank tab had never loaded a document.
    await page.getByTitle('新建标签页', { exact: true }).click();
    await page.getByRole('tab', { name: 'Example Domain', exact: true }).click();
    await files.click(); await page.getByText('self-test-note.txt', { exact: true }).waitFor(); await shot('closed');
    await browser.click();
    await page.getByRole('tab', { name: 'Example Domain', exact: true }).waitFor();
    check(await target.title() === 'Example Domain', '实际浏览器文档标题不符');
    check((await address.inputValue()).includes('example.com'), '重新打开后浏览器地址丢失');
    await target.locator('body').filter({ hasText: /documentation examples|illustrative examples/i }).waitFor();
    await shot('reopened', target); await shot('reopened-host');
    await files.click(); await input().waitFor();
    return ['通过会话右侧浏览器实际导航 example.com，原生浏览器页面标题与地址一致，保存真实页面和 Host 地址截图。', '实际刷新页面、新建空白标签后切回原页、关闭面板并重新打开；Example Domain 页面与地址保留，最终返回文件页。'];
  },
  'session-terminal': async ({ page, fixture, input, shot, check, fixturePath }) => {
    await fixture();
    await page.getByRole('button', { name: '终端菜单', exact: true }).click();
    const [terminal] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 15000 }),
      page.getByRole('menuitem', { name: '终端', exact: true }).click(),
    ]);
    try {
      await terminal.getByText('运行中', { exact: true }).waitFor({ timeout: 15000 });
      const cwd = await terminal.locator('header span[title]').getAttribute('title');
      const normalized = value => String(value).replace(/\\/g, '/');
      const expected = normalized(fixturePath).replace(/\/[^/]+$/, '');
      check(normalized(cwd) === expected, '终端未绑定本轮样例工作区');
      check((await terminal.locator('header strong').innerText()).includes('自测样例'), '终端会话不符');
      await terminal.locator('.xterm-helper-textarea').focus();
      // Keep the exact marker out of the echoed command. Only shell execution
      // can produce MOSS_TERMINAL_OK in the visible terminal output.
      await terminal.keyboard.type("printf 'MOSS_%s_OK\\n' TERMINAL"); await terminal.keyboard.press('Enter');
      await terminal.keyboard.type('pwd'); await terminal.keyboard.press('Enter');
      await terminal.keyboard.type('exit'); await terminal.keyboard.press('Enter');
      await terminal.getByText('已退出（0）', { exact: true }).waitFor({ timeout: 15000 });
      check(await terminal.getByRole('alert').count() === 0, '终端存在错误提示');
      await shot('actual-output', terminal);
    } finally { await terminal.close(); }
    await input().waitFor(); await shot('returned');
    return ['从自测样例实际打开终端，窗口标题对应本轮会话，终端声明目录精确等于附件所在工作区。', '通过真实终端键盘执行格式化标记输出及 pwd，再正常 exit 0；截图供独立核对 MOSS_TERMINAL_OK 和实际目录，关闭后会话可交互。'];
  },
  'app-marketplace': async ({ page, shot, check }) => {
    await page.getByRole('button', { name: /^Apps \d+$/ }).click();
    await page.getByRole('button', { name: '应用市场', exact: true }).click();
    await page.getByRole('heading', { name: '应用市场', exact: true }).waitFor();
    const refresh = page.getByRole('button', { name: '刷新', exact: true });
    await refresh.waitFor({ timeout: 20000 });
    const panel = page.getByRole('tabpanel', { name: /^全部/ });
    const cards = page.locator('#marketplace-apps section[data-app-category]');
    await cards.first().waitFor({ timeout: 20000 });
    const original = await cards.count(), category = await cards.first().getAttribute('data-app-category');
    await shot('catalog');
    const categoryTab = page.locator('[role="tab"][id="marketplace-apps-' + category + '"]');
    await categoryTab.click();
    const found = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-app-category')));
    check(found.length > 0 && found.every(value => value === category), '市场分类混入其他分类');
    await shot('category');
    await page.locator('#marketplace-apps-all').click();
    check(await cards.count() === original, '回到全部后列表未恢复');
    const first = cards.first(), title = await first.getByRole('heading', { level: 3 }).innerText();
    await first.getByRole('button', { name: '详情', exact: true }).click();
    await first.getByText('可用版本', { exact: true }).waitFor({ timeout: 20000 });
    check(await first.getByRole('combobox').locator('option').count() > 0, '市场详情没有实际版本');
    await shot('details', first);
    await first.getByRole('button', { name: '详情', exact: true }).click();
    await first.getByText('可用版本', { exact: true }).waitFor({ state: 'hidden' });
    await refresh.click(); await refresh.waitFor({ timeout: 20000 });
    await cards.first().waitFor(); await shot('refreshed');
    await page.getByRole('button', { name: '返回已安装 App', exact: true }).click();
    await page.getByRole('button', { name: '应用市场', exact: true }).waitFor(); await shot('returned');
    return [`实际加载 ${original} 个市场条目，分类 ${category} 只显示所属应用，切回全部后恢复列表；当前市场实现没有名称搜索入口，未声称已验证搜索。`, `实际打开 ${title} 详情并查看可用版本；收起、刷新和返回已安装 Apps 均完成，没有安装或升级。`];
  },
  'app-tool-scope': async ({ page, settings, shot, check }) => {
    const tools = async () => {
      await settings(); await page.locator('[data-settings-nav="tools"]:visible').click();
      const group = page.getByRole('table', { name: 'App 提供的工具', exact: true }).locator('tbody')
        .filter({ has: page.locator('th code').filter({ hasText: /^moss\.markitdown\./ }) });
      await group.getByText('指定 · 选择后常驻', { exact: true }).first().waitFor({ timeout: 20000 });
      check((await group.innerText()).includes('文档转换'), '工具来源名称不符');
      check(await group.getByRole('alert').count() === 0, '文档转换工具存在加载错误');
      return group;
    };
    let group = await tools();
    const expand = group.getByRole('button', { name: /^展开 .+ 的说明$/ }).first();
    if (await expand.count()) await expand.click();
    await shot('tool-declaration', group);
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    const trigger = page.getByRole('button', { name: /^选择资源/ });
    const select = async () => {
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: '选择资源', exact: true });
      await dialog.getByRole('tab', { name: 'App', exact: true }).click();
      const row = dialog.locator('button[aria-pressed]').filter({ has: page.getByText('文档转换', { exact: true }) });
      await row.waitFor(); return { dialog, row };
    };
    let { dialog, row } = await select();
    check(await row.getAttribute('aria-pressed') === 'false', '新会话已有文档转换选择');
    await row.click(); await shot('selected', dialog); await dialog.getByRole('button', { name: '确定', exact: true }).click();
    const tag = page.getByRole('button', { name: '移除 App：文档转换', exact: true });
    await tag.waitFor(); await shot('tag');
    ({ dialog, row } = await select()); check(await row.getAttribute('aria-pressed') === 'true', '重新打开后选择丢失');
    await shot('persisted', dialog); await row.click(); await dialog.getByRole('button', { name: '确定', exact: true }).click();
    await tag.waitFor({ state: 'hidden' }); await shot('removed');
    group = await tools(); await shot('scope-retained', group);
    return ['已核对文档转换的真实工具名称、来源与说明；声明范围为“指定 · 选择后常驻”，与该 App 的 session 范围一致。', '新会话实际关联后标签出现、重新打开勾选保留，取消后标签消失；再次查看设置，App 声明范围仍保持不变。'];
  },
  'app-launch': async ({ page, shot, check, appWebview, evidence }) => {
    check(typeof appWebview === 'function', '缺少 App 内嵌页面证据读取能力');
    const apps = async () => { await page.getByRole('button', { name: /^Apps \d+$/ }).click(); await page.getByRole('tab', { name: /^全部/ }).click(); };
    await apps();
    const card = page.locator('section[data-app-category]').filter({ has: page.locator('[data-app-open="moss.audit"]') });
    await card.waitFor();
    check(await card.locator('input[role="switch"]').isChecked(), '审计 App 未启用，需要选择其他已启用 UI App 诊断');
    const settings = card.locator('[data-app-settings="moss.audit"]');
    const hasSettings = await settings.count() > 0;
    const inspect = async stage => {
      // Main App content has its own toolbar; only the settings route has the
      // settings back button. Return from the main view via the public Apps nav.
      await page.locator('[data-app-toolbar-actions]:visible').waitFor();
      if (stage === 'settings') await page.getByRole('button', { name: '返回 Apps 设置', exact: true }).waitFor();
      await page.getByText('正在打开 App', { exact: true }).waitFor({ state: 'hidden', timeout: 20000 });
      await page.waitForFunction(() => [...document.querySelectorAll('webview[src^="moss-app://"]')].some(node => {
        const box = node.getBoundingClientRect(); return box.width > 300 && box.height > 200;
      }));
      const source = await page.locator('webview[src^="moss-app://"]').evaluateAll(nodes => nodes
        .map(node => ({ source: node.getAttribute('src'), box: node.getBoundingClientRect() }))
        .filter(item => item.box.width > 300 && item.box.height > 200)
        .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0]?.source);
      check(Boolean(source), '没有找到当前 App 主视图');
      const result = await appWebview(source, { prefix: 'app-launch-' + stage, expectedText: stage === 'settings' ? '' : '审计中心' });
      evidence.push(...result.evidence); check(!result.error, result.error);
      await shot(stage + '-host');
    };
    await card.locator('[data-app-open]').click(); await inspect('opened');
    await apps(); await card.waitFor(); await shot('returned');
    await card.locator('[data-app-open]').click(); await inspect('reopened');
    await apps(); await card.waitFor();
    if (hasSettings) { await settings.click(); await inspect('settings'); await page.getByRole('button', { name: '返回 Apps 设置', exact: true }).click(); }
    return ['通过已安装 Apps 打开审计中心，主视图已实际渲染审计记录内容；取得真实内嵌页面截图并成功返回 Apps。', `再次打开仍加载实际 App 内容，未执行任何审计或业务写入；${hasSettings ? '声明的设置入口也已打开并检查。' : '该 App 未声明独立设置入口。'}`];
  },
  'preview-office': async ({ page, input, shot, check, marker, openPreview, nativePdf, evidence }) => {
    check(typeof nativePdf === 'function', '缺少原生文件预览截图能力');
    const suffix = marker.split(' ')[1].slice(0, 8), base = 'office-' + suffix, token = 'OFFICE_CREATED_' + suffix;
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    await input().fill(`使用已有工具或本地脚本实际生成三个合法 Office 文件：${base}.docx、${base}.xlsx、${base}.pptx。Word 正文和 PPT 单页含 OFFICE_PREVIEW 和总额 580；Excel 单个工作表 A1 为 OFFICE_PREVIEW、B1 为数值 580，A 列宽度设为 28，确保完整文字可见。三种文件的内容都要在页面内完整显示，不截断。不安装软件，不修改其他文件。生成完成后回复 ${token}；缺少能力时明确说明，不模拟文件。`);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.locator('[data-message-body="assistant"]').filter({ hasText: token }).waitFor({ timeout: 240000 });
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 60000 });
    const expand = page.getByRole('button', { name: '展开右侧栏', exact: true });
    if (await expand.isVisible()) await expand.click();
    await page.getByRole('button', { name: '刷新工作区', exact: true }).click();
    // File cards in chat also carry title=name. Only the file tree uses these
    // flex item classes; names here contain a generated UUID prefix only.
    for (const extension of ['docx', 'xlsx', 'pptx']) await page.locator('span.min-w-0.flex-1[title="' + base + '.' + extension + '"]').waitFor();
    await shot('generated');
    for (const extension of ['docx', 'xlsx', 'pptx']) {
      const name = base + '.' + extension;
      for (const stage of ['opened', 'reopened']) {
        const target = await openPreview(() => page.locator('span.min-w-0.flex-1[title="' + name + '"]').click());
        try {
          await target.getByText(name, { exact: true }).first().waitFor();
          await target.locator('webview').waitFor({ state: 'attached', timeout: 60000 });
          const source = await target.locator('webview').getAttribute('src');
          check(Boolean(source), name + '预览来源缺失');
          const result = await nativePdf(decodeURIComponent(new URL(source).pathname), { prefix: 'preview-office-' + extension + '-' + stage, verifyZoom: false });
          evidence.push(...result.evidence); check(!result.error, result.error);
          await shot(extension + '-' + stage + '-source', target);
        } finally { await target.close(); }
        await input().waitFor();
      }
    }
    await shot('returned');
    return ['实际模型生成三种 Office 文件；逐一打开，并从对应预览来源取得原生查看器的真实页面截图，供核对正文、单元格和幻灯片中的 OFFICE_PREVIEW 与 580。', '三种预览均实际关闭再重新打开，分别保存文件名与对应原生页面证据；最终返回当前会话。'];
  },
  'workspace-restore': async ({ page, input, shot, check, marker, openPreview }) => {
    const suffix = marker.split(' ')[1].slice(0, 8), name = 'restore-' + suffix + '.txt';
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    const change = async version => {
      await input().fill(`仅${version === 'ONE' ? '创建' : '修改'}工作区文件 ${name}，内容为 VERSION_${version}，不要改其他文件。完成后回复 RESTORE_${version}_${suffix}。`);
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await page.locator('[data-message-body="assistant"]').filter({ hasText: `RESTORE_${version}_${suffix}` }).waitFor({ timeout: 120000 });
      await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 60000 });
      const expand = page.getByRole('button', { name: '展开右侧栏', exact: true });
      if (await expand.isVisible()) await expand.click();
      await page.getByRole('button', { name: '刷新工作区', exact: true }).click();
      await page.locator('span.min-w-0.flex-1[title="' + name + '"]').waitFor();
    };
    const current = async version => {
      const preview = await openPreview(() => page.locator('span.min-w-0.flex-1[title="' + name + '"]').click());
      try { await preview.getByText('VERSION_' + version, { exact: false }).waitFor(); await shot('current-' + version, preview); }
      finally { await preview.close(); }
    };
    const save = async label => {
      await page.getByRole('button', { name: '保存版本', exact: true }).click();
      await page.getByRole('textbox', { name: '版本', exact: true }).fill(label);
      await page.getByRole('button', { name: '确认保存版本', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '已保存版本' }).waitFor();
    };
    await change('ONE'); await current('ONE'); await save('before-' + suffix);
    await change('TWO'); await current('TWO'); await save('after-' + suffix);
    await page.getByRole('button', { name: '历史版本', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '历史版本', exact: true });
    const history = async (label, version) => {
      await dialog.getByRole('button').filter({ hasText: '个文件改动' }).filter({ hasText: label }).click();
      await dialog.getByRole('textbox', { name: '搜索版本文件', exact: true }).fill(name);
      await dialog.getByRole('button', { name, exact: true }).click();
      await dialog.getByText('VERSION_' + version, { exact: false }).waitFor(); await shot('history-' + version, dialog);
    };
    await history('after-' + suffix, 'TWO'); await history('before-' + suffix, 'ONE');
    await dialog.getByRole('button', { name: '恢复到此版本', exact: true }).click();
    const confirm = dialog.getByRole('button', { name: '备份并恢复', exact: true });
    await confirm.waitFor();
    const changes = confirm.locator('../..').getByRole('listitem');
    check(await changes.count() === 1 && (await changes.innerText()).includes(name), '恢复范围超出本轮单个文件');
    await shot('restore-scope', dialog); await confirm.click();
    await confirm.waitFor({ state: 'hidden', timeout: 20000 });
    await dialog.getByRole('button', { name: '返回当前工作区', exact: true }).click();
    await page.getByRole('button', { name: '刷新工作区', exact: true }).click();
    await current('ONE'); await shot('returned');
    return ['模型实际创建 VERSION_ONE 并改为 VERSION_TWO；实际文件预览及 before/after 历史内容均已分别核对并留存。', `恢复确认范围仅含 ${name}；执行备份并恢复后刷新并重新打开真实文件，正文为 VERSION_ONE，返回后当前工作区可操作。`];
  },
  'attachment-send': async ({ page, input, shot, check, fixturePath }) => {
    check(Boolean(fixturePath), '缺少本轮实际附件路径');
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    const channel = await page.context().newCDPSession(page);
    const attach = async () => {
      const box = await input().boundingBox();
      check(Boolean(box), '附件拖放目标不可见');
      const data = { items: [], files: [fixturePath], dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await channel.send('Input.dispatchDragEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, data });
      }
      await page.getByRole('button', { name: '移除 self-test-note.txt', exact: true }).waitFor();
    };
    try {
      await attach(); await shot('attached');
      await page.getByRole('button', { name: '移除 self-test-note.txt', exact: true }).click();
      await page.locator('[data-file-attachment]').waitFor({ state: 'hidden' }); await shot('removed');
      await attach(); await shot('reattached');
    } finally { await channel.detach(); }
    await input().fill('读取附件并原样回复其第一行。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.locator('[data-message-body="assistant"]').filter({ hasText: 'Moss self-test fixture' }).waitFor({ timeout: 90000 });
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 60000 });
    check(await page.locator('[data-file-attachment]').filter({ hasText: 'self-test-note.txt' }).count() === 1, '发送后实际消息附件关联缺失或重复');
    check(!await page.getByRole('button', { name: '移除 self-test-note.txt', exact: true }).count(), '发送后附件仍留在输入区');
    await shot('actual-reply');
    return ['通过 Chromium 文件拖放将本轮真实文件导入附件区，标签出现、移除和再次导入均已核对；此路径不验证系统文件选择窗口。', '未在用户提示中提供文件正文；真实 assistant 回复包含附件首行，发送后消息保留一份对应附件关联。'];
  },
  'project-decisions': async ({ page, shot, check, marker, openPreview }) => {
    const suffix = marker.split(' ')[1].slice(0, 8), name = 'decision-' + suffix;
    await page.getByRole('button', { name: '项目', exact: true }).click();
    const back = page.getByRole('button', { name: '项目 / 返回列表', exact: true });
    if (await back.isVisible()) await back.click();
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByPlaceholder('项目', { exact: true }).fill(name);
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    const expand = page.getByRole('button', { name: '在右侧展开项目配置', exact: true });
    if (await expand.isVisible()) await expand.click();
    const policy = page.getByText('决策策略', { exact: true }).locator('..').locator('select');
    await policy.selectOption('recommend');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.getByRole('button', { name: '保存配置', exact: true }).waitFor();
    await shot('policy');
    await page.getByRole('button', { name: '任务', exact: true }).click();
    const create = page.getByLabel('创建项目任务', { exact: true });
    await create.getByPlaceholder('描述希望项目完成的事情...').fill('开始前调用真实提问工具 AskUserQuestion，问题为“报告输出语言？”，选项为“中文”和“英文”。必须等用户回答，不能用普通文字提问或自动选择。收到回答后按用户选择保存 decision-report.md，内容只需一句说明所选语言。');
    await create.getByRole('button', { name: '发送', exact: true }).click();
    // Task creation opens its conversation. Return through the actual UI before
    // inspecting project tabs; waiting for a card in the chat view cannot work.
    await page.getByRole('button', { name: '查看会话信息', exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: '项目', exact: true }).click();
    const projectHeading = page.getByRole('heading', { name, exact: true }), projectSearch = page.getByPlaceholder('搜索项目');
    await projectHeading.or(projectSearch).waitFor();
    if (!await projectHeading.isVisible()) { await projectSearch.fill(name); await page.getByRole('button').filter({ hasText: name }).first().click(); await projectHeading.waitFor(); }
    await page.getByRole('button', { name: '待决策', exact: true }).click();
    const decision = page.locator('article').filter({ has: page.getByRole('button', { name: '确认决定', exact: true }) });
    await decision.waitFor({ timeout: 180000 });
    check((await decision.innerText()).includes('语言'), '待决策内容不对应本轮语言任务');
    await shot('pending', decision);
    const chinese = /^中文(?:[（(]推荐[）)])?$/;
    await decision.getByRole('button').filter({ has: page.getByText(chinese) }).click();
    await shot('selected', decision);
    await decision.getByRole('button', { name: '确认决定', exact: true }).click();
    await page.getByRole('button', { name: '确认决定', exact: true }).waitFor({ state: 'hidden' });
    const resolved = page.locator('article').filter({ hasText: '报告输出语言' });
    await resolved.getByText('已决定', { exact: true }).waitFor();
    await shot('resolved');
    await page.getByRole('button', { name: '任务', exact: true }).click();
    await page.locator('article').getByText('已完成', { exact: true }).waitFor({ timeout: 180000 });
    await shot('completed');
    await page.locator('article').getByTitle('进入任务会话', { exact: true }).click();
    await page.getByRole('button', { name: '查看会话信息', exact: true }).waitFor();
    const expandFiles = page.getByRole('button', { name: '展开右侧栏', exact: true });
    if (await expandFiles.isVisible()) await expandFiles.click();
    const reportFile = page.locator('span.min-w-0.flex-1[title="decision-report.md"]');
    if (!await reportFile.isVisible()) await page.locator('span.min-w-0.flex-1[title="outputs"]').click();
    const preview = await openPreview(() => reportFile.click());
    try { await preview.getByText(/中文/).first().waitFor({ timeout: 15000 }); await shot('report', preview); }
    finally { await preview.close(); }
    await page.getByRole('button', { name: '项目', exact: true }).click();
    await projectHeading.or(projectSearch).waitFor();
    if (!await projectHeading.isVisible()) { await projectSearch.fill(name); await page.getByRole('button').filter({ hasText: name }).first().click(); await projectHeading.waitFor(); }
    await page.getByRole('button', { name: '资产', exact: true }).click();
    const asset = page.getByRole('button', { name: '打开资产：decision-report.md', exact: true });
    await asset.waitFor({ timeout: 15000 });
    await shot('asset-associated');
    await page.getByRole('button', { name: '待决策', exact: true }).click();
    const history = page.locator('article').filter({ hasText: '报告输出语言' });
    const header = history.locator('button[aria-expanded]');
    if (await header.getAttribute('aria-expanded') === 'false') await header.click();
    await history.getByText(chinese).waitFor(); await shot('choice-retained', history);
    return ['项目设置为人工确认，实际任务产生语言待决策卡；通过项目页选择中文并确认，状态变为已决定。', '回答后任务实际完成；通过任务工作区预览 decision-report.md 可见中文正文，资产列表有对应文件，回到待决策历史仍保留中文选择。资产按钮走系统外部应用，不在此处验证外部编辑器。'];
  },
  'project-task': async ({ page, shot, check, marker, openPreview }) => {
    const suffix = marker.split(' ')[1].slice(0, 8), name = 'tasks-' + suffix, token = 'PROJECT_TASK_OK_' + suffix;
    await page.getByRole('button', { name: '项目', exact: true }).click();
    const back = page.getByRole('button', { name: '项目 / 返回列表', exact: true });
    if (await back.isVisible()) await back.click();
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByPlaceholder('项目', { exact: true }).fill(name);
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await page.getByRole('button', { name: '任务', exact: true }).click();
    const create = page.getByLabel('创建项目任务', { exact: true });
    await create.getByPlaceholder('描述希望项目完成的事情...').fill(`计算 120*2+80*3+50*2，保存 project-result.md，并回复 ${token}`);
    await create.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('button', { name: '查看会话信息', exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: '项目', exact: true }).click();
    const projectHeading = page.getByRole('heading', { name, exact: true }), projectSearch = page.getByPlaceholder('搜索项目');
    await projectHeading.or(projectSearch).waitFor();
    if (!await projectHeading.isVisible()) { await projectSearch.fill(name); await page.getByRole('button').filter({ hasText: name }).first().click(); await projectHeading.waitFor(); }
    await page.getByRole('button', { name: '任务', exact: true }).click();
    const task = page.locator('article').first();
    await task.getByText('已完成', { exact: true }).waitFor({ timeout: 240000 });
    await shot('completed');
    await task.getByTitle('查看详情', { exact: true }).click();
    // Completion precedes asynchronous result finalization. The conclusion may
    // summarize success without repeating arithmetic; verify 580 in the actual
    // assistant reply and generated report below.
    const conclusion = task.getByText('任务结论', { exact: true });
    await conclusion.waitFor({ timeout: 60000 });
    check(Boolean((await conclusion.locator('..').locator('div').last().innerText()).trim()), '任务结论为空');
    await shot('details', task);
    const subject = await task.locator('button div.truncate').first().innerText();
    const query = page.getByPlaceholder('查询任务');
    await query.fill(subject); await task.waitFor(); await shot('search');
    await query.fill('NO_TASK_' + suffix); await page.getByText('没有匹配的任务', { exact: true }).waitFor(); await shot('empty');
    await query.fill('');
    const filter = page.getByLabel('按任务状态过滤', { exact: true });
    await filter.selectOption('failed'); await page.getByText('没有匹配的任务', { exact: true }).waitFor();
    await filter.selectOption('completed'); await task.getByText('已完成', { exact: true }).waitFor(); await shot('filtered');
    await task.getByTitle('进入任务会话', { exact: true }).click();
    const reply = page.locator('[data-message-body="assistant"]').filter({ hasText: token }).last();
    await reply.waitFor({ timeout: 15000 });
    check((await reply.innerText()).includes('580'), '真实 assistant 回复缺少总额 580'); await shot('reply');
    const expandFiles = page.getByRole('button', { name: '展开右侧栏', exact: true });
    if (await expandFiles.isVisible()) await expandFiles.click();
    const reportFile = page.locator('span.min-w-0.flex-1[title="project-result.md"]');
    if (!await reportFile.isVisible()) await page.locator('span.min-w-0.flex-1[title="outputs"]').click();
    const preview = await openPreview(() => reportFile.click());
    try { await preview.getByText(/580/).first().waitFor({ timeout: 15000 }); await shot('actual-report', preview); }
    finally { await preview.close(); }
    await page.getByRole('button', { name: '项目', exact: true }).click();
    const heading = page.getByRole('heading', { name, exact: true }), search = page.getByPlaceholder('搜索项目');
    await heading.or(search).waitFor();
    if (!await heading.isVisible()) { await search.fill(name); await page.getByRole('button').filter({ hasText: name }).first().click(); await heading.waitFor(); }
    await page.getByRole('button', { name: '资产', exact: true }).click();
    const asset = page.getByRole('button', { name: '打开资产：project-result.md', exact: true });
    await asset.waitFor({ timeout: 15000 });
    await shot('asset-associated');
    return [`实际创建并完成 ${name} 项目任务，进入关联会话后真实 assistant 回复含 ${token} 和总额 580。`, '任务详情、标题搜索、无匹配状态及完成/失败筛选均已检查；从任务工作区实际预览 project-result.md，正文显示 580，资产列表保留对应文件。资产按钮走系统外部应用，不在此处验证外部编辑器。'];
  },
  'project-resources': async ({ page, shot, check, marker }) => {
    const name = 'resources-' + marker.split(' ')[1].slice(0, 8);
    await page.getByRole('button', { name: '项目', exact: true }).click();
    const back = page.getByRole('button', { name: '项目 / 返回列表', exact: true });
    if (await back.isVisible()) await back.click();
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByPlaceholder('项目', { exact: true }).fill(name);
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    const expand = async () => {
      const button = page.getByRole('button', { name: '在右侧展开项目配置', exact: true });
      if (await button.isVisible()) await button.click();
    };
    await expand();
    const options = [ ['添加个人授权连接器', '选择已授权连接器'], ['添加技能', '选择技能'], ['添加专家', '选择专家'] ];
    const observations = []; let candidate;
    const open = async (title, dialogName) => {
      await page.getByText(title, { exact: true }).locator('../..').getByRole('button', { name: '选择', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
      await dialog.waitFor();
      const loading = dialog.getByText('正在加载...', { exact: true });
      // The picker schedules its initial fetch after opening. Waiting only for
      // "hidden" can return before loading has even started. A cached result may
      // skip the visible loading frame; still check the final state afterward.
      await loading.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {});
      await loading.waitFor({ state: 'hidden', timeout: 20000 });
      return dialog;
    };
    for (const [title, dialogName] of options) {
      const dialog = await open(title, dialogName), rows = dialog.locator('button[aria-pressed]');
      const text = await dialog.innerText();
      check(!text.includes('正在加载'), '资源仍在加载，不能当成空列表');
      observations.push(`${dialogName}：${await rows.count()} 个条目；${text.slice(0, 300)}`);
      if (title !== '添加个人授权连接器' && !candidate && await rows.count()) candidate = { title, dialogName, name: await rows.first().locator('span.block.truncate.text-sm.font-medium').innerText() };
      await shot(dialogName, dialog); await dialog.getByRole('button', { name: '确定', exact: true }).click();
    }
    check(Boolean(candidate), '项目资源服务未提供可选技能或专家：' + observations.join('；'));
    const select = async expected => {
      const dialog = await open(candidate.title, candidate.dialogName);
      const row = dialog.locator('button[aria-pressed]').filter({ has: page.getByText(candidate.name, { exact: true }) }).first();
      await row.waitFor(); check(await row.getAttribute('aria-pressed') === String(expected), '项目资源关联状态未保留');
      return { dialog, row };
    };
    const save = async () => {
      await page.getByRole('button', { name: '保存配置', exact: true }).click();
      await page.getByRole('button', { name: '保存配置', exact: true }).waitFor();
      await back.click(); await page.getByPlaceholder('搜索项目').fill(name);
      await page.getByRole('button').filter({ hasText: name }).first().click();
      await page.getByRole('heading', { name, exact: true }).waitFor(); await expand();
    };
    let { dialog, row } = await select(false);
    await row.click(); await shot('selected', dialog); await dialog.getByRole('button', { name: '确定', exact: true }).click();
    await shot('label'); await save();
    ({ dialog, row } = await select(true)); await shot('persisted', dialog);
    await row.click(); await dialog.getByRole('button', { name: '确定', exact: true }).click(); await save();
    ({ dialog } = await select(false)); await shot('removed', dialog); await dialog.getByRole('button', { name: '确定', exact: true }).click();
    return [`已新建 ${name}，三类资源选择器均等待加载结束后检查；从真实列表关联 ${candidate.name}，选择状态与标签一致。`, '保存后离开并重新打开，选择项仍勾选；取消并再次保存、重新打开，勾选已解除。'];
  },
  'resource-selection': async ({ page, shot, check }) => {
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    const trigger = page.getByRole('button', { name: /^选择资源/ });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '选择资源', exact: true });
    const tabs = dialog.getByRole('tab');
    const labels = (await tabs.allTextContents()).map(value => value.trim());
    const rows = dialog.locator('button[aria-pressed]').filter({ has: page.locator('span.block.truncate.text-sm.font-medium') });
    let candidate;
    for (const label of labels) {
      await dialog.getByRole('tab', { name: label, exact: true }).click();
      await dialog.getByText('正在加载已安装技能...', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 });
      if (await rows.count()) {
        const row = rows.first();
        if (!candidate || label === '技能') candidate = { label, name: await row.locator('span.block.truncate.text-sm.font-medium').innerText() };
      } else if (await dialog.locator('button').filter({ has: page.locator('span.block.truncate.text-sm.font-medium') }).count() === 0) {
        check((await dialog.innerText()).includes('没有匹配'), label + '缺少明确空状态');
      }
      await shot(label, dialog);
      // App resource providers can add tabs after the picker first renders.
      // Inspect newly visible categories in this same pass.
      for (const value of (await tabs.allTextContents()).map(text => text.trim())) {
        if (!labels.includes(value)) labels.push(value);
      }
    }
    check(Boolean(candidate), '没有可选择的已安装资源');
    await dialog.getByRole('tab', { name: candidate.label, exact: true }).click();
    const row = rows.filter({ has: page.getByText(candidate.name, { exact: true }) }).first();
    check(await row.getAttribute('aria-pressed') === 'false', '新会话资源已有选择，需要隔离检查');
    await row.click(); await page.keyboard.press('Escape');
    const prefix = { App: '移除 App：', 技能: '移除技能：', 专家: '移除助手：', Agents: '移除 Agent：', 连接器: '移除连接器：', 工作流: '移除工作流：' }[candidate.label];
    const tag = page.getByLabel('已选资源', { exact: true }).getByRole('button', { name: prefix + candidate.name, exact: true });
    await tag.waitFor(); await tag.hover();
    if (['技能', '专家', '连接器'].includes(candidate.label)) await page.getByRole('tooltip').filter({ hasText: candidate.name }).waitFor();
    await shot('selected');
    await trigger.click();
    await dialog.getByRole('tab', { name: candidate.label, exact: true }).click();
    check(await row.getAttribute('aria-pressed') === 'true', '重新打开已选状态丢失');
    await row.click(); await page.keyboard.press('Escape');
    await tag.waitFor({ state: 'hidden' }); await shot('removed');
    return [`逐一查看实际资源分类 ${labels.join('、')}，保存各类条目或明确空状态截图。`, `选择已安装资源 ${candidate.name} 后输入区标签出现，重新打开勾选保留；取消后标签移除。`];
  },
  'session-rename': async ({ page, send, shot, check, marker }) => {
    const chat = await send('rename', 'RENAME_OK');
    const menu = page.getByRole('button', { name: /^打开“.*”的会话设置$/ });
    const labels = await menu.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    const label = labels.find(value => value.includes(chat.title));
    check(Boolean(label), '本轮会话设置入口缺失');
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
    const edit = page.locator('[role="button"] input[type="text"]:visible');
    const renamed = 'rename-' + marker.split(' ')[1].slice(0, 8);
    await edit.fill(renamed); await edit.press('Enter');
    const reopened = page.getByRole('button', { name: `打开“${renamed}”的会话设置`, exact: true }).locator('../..');
    await reopened.waitFor(); await shot('renamed');
    await page.getByRole('button', { name: '新会话', exact: true }).click(); await reopened.click();
    await page.locator('[data-message-body="assistant"]').filter({ hasText: 'RENAME_OK' }).waitFor();
    check((await page.locator('[data-message-body="user"]').innerText()).includes(chat.title), '重命名丢失用户消息');
    await shot('reopened');
    await page.getByRole('button', { name: '搜索所有消息', exact: true }).click();
    const search = page.getByPlaceholder('搜索所有会话的标题与消息正文');
    await search.fill(renamed);
    const hit = search.locator('../..').getByRole('button').filter({ hasText: renamed }).first();
    await hit.waitFor(); await shot('search'); await hit.click();
    await page.locator('[data-message-body="assistant"]').filter({ hasText: 'RENAME_OK' }).waitFor();
    await shot('search-opened');
    return [`真实回复后通过侧栏重命名为 ${renamed}，离开再打开新名称与双方消息均保留。`, '全局搜索新名称命中；点击结果进入包含真实 RENAME_OK 回复的原会话。'];
  },
  'message-queue': async ({ page, input, shot, check, marker }) => {
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    await input().fill(marker + ' 请详细列举 30 个测试场景。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('button', { name: '停止', exact: true }).waitFor({ timeout: 15000 });
    const token = 'QUEUE_OK_' + marker.split(' ')[1].slice(0, 8);
    await input().fill('请只回复 ' + token);
    const enqueue = page.getByRole('button', { name: '排队', exact: true });
    check(await enqueue.isVisible(), '没有捕获生成窗口，不能用两次串行发送代替排队');
    await enqueue.click();
    await page.getByText('#1 排队中', { exact: true }).waitFor(); await shot('queued');
    await page.locator('[data-message-body="assistant"]').filter({ hasText: token }).waitFor({ timeout: 180000 });
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 60000 });
    check(await page.locator('[data-message-body="user"]').count() === 2, '用户消息重复或丢失');
    check(await page.locator('[data-message-body="assistant"]').count() >= 2, '缺少实际两轮回复');
    check(await page.getByTitle('移除排队消息', { exact: true }).count() === 0, '队列没有清空');
    await shot('complete');
    return ['生成中使用排队按钮追加消息，实际看到 #1 排队中并保存截图，没有串行发送替代。', `两轮回复结束，assistant 包含 ${token}，用户消息恰为两条且队列清空、发送入口恢复。`];
  },
  'session-fork': async ({ page, send, input, shot, check, marker }) => {
    const suffix = marker.split(' ')[1].slice(0, 8), base = 'FORK_BASE_' + suffix, child = 'FORK_CHILD_' + suffix;
    const original = await send('base', base);
    const menus = page.getByRole('button', { name: /^打开“.*”的会话设置$/ });
    const before = await menus.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    const originalLabel = before.find(value => value.includes(original.title));
    check(Boolean(originalLabel), '原会话设置入口缺失');
    await page.getByRole('button', { name: '从此处打开新会话', exact: true }).last().click();
    await page.waitForFunction(labels => [...document.querySelectorAll('button[aria-label^="打开“"][aria-label$="”的会话设置"]')].some(node => !labels.includes(node.getAttribute('aria-label'))), before);
    const label = (await menus.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).find(value => !before.includes(value));
    check(Boolean(label), '分支未创建新会话');
    await page.locator('[data-message-body="assistant"]').filter({ hasText: base }).waitFor(); await shot('inherited');
    await input().fill('请只回复 ' + child); await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.locator('[data-message-body="assistant"]').filter({ hasText: child }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 60000 });
    await shot('child');
    await page.getByRole('button', { name: originalLabel, exact: true }).locator('../..').click();
    await page.getByLabel('会话操作：' + originalLabel.slice(3, -6), { exact: true }).waitFor();
    await page.locator('[data-message-body="assistant"]').filter({ hasText: base }).waitFor();
    check(!(await page.locator('[data-message-body="assistant"]').allInnerTexts()).join('\n').includes(child), '原会话出现分支的新回复');
    await shot('original');
    await page.getByRole('button', { name: label, exact: true }).locator('../..').click();
    await page.getByLabel('会话操作：' + label.slice(3, -6), { exact: true }).waitFor();
    await page.locator('[data-message-body="assistant"]').filter({ hasText: child }).waitFor(); await shot('child-reopened');
    return ['通过消息分支入口实际创建新会话，分支继承真实 FORK_BASE 回复。', '分支发送后收到真实 FORK_CHILD 回复；切回原会话没有该回复，再回分支仍保留。'];
  },
  'app-toggle': async ({ page, shot, check }) => {
    const open = async () => { await page.getByRole('button', { name: /^Apps \d+$/ }).click(); await page.getByRole('tab', { name: /^全部/ }).click(); };
    await open();
    // Audit is a local read-only UI App; avoid activating an external channel.
    const card = page.locator('section[data-app-category]').filter({ has: page.locator('[data-app-open="moss.audit"]') });
    await card.waitFor();
    const toggle = card.locator('input[role="switch"]'), entry = card.locator('[data-app-open]');
    const original = await toggle.isChecked();
    try {
      if (original) await toggle.locator('..').click();
      await entry.filter({ hasText: '请先启用' }).waitFor(); check(await entry.isDisabled(), '停用后入口仍可操作');
      await shot('disabled', card);
      await toggle.locator('..').click(); await entry.filter({ hasText: '打开' }).waitFor(); check(await entry.isEnabled(), '启用后入口不可用');
      await shot('enabled', card);
      await page.getByRole('button', { name: '新会话', exact: true }).click(); await open();
      check(await toggle.isChecked(), '离开再进入启用状态未保留');
    } finally { if (await toggle.isChecked() !== original) await toggle.locator('..').click();
      await page.waitForFunction(value => document.querySelector('[data-app-open="moss.audit"]').closest('section').querySelector('input[role="switch"]').checked === value, original); }
    await shot('restored', card);
    return ['对隔离实例的审计 App 实际停用和启用；停用时打开入口禁用，启用后恢复。', `离开后重新进入状态保留，最后恢复原状态 ${original ? '启用' : '停用'}；未操作自测 App。`];
  },
  'app-versions': async ({ page, shot, check }) => {
    await page.getByRole('button', { name: /^Apps \d+$/ }).click(); await page.getByRole('tab', { name: /^全部/ }).click();
    const card = page.locator('section[data-app-category]').filter({ has: page.locator('[data-app-open="moss.audit"]') });
    await card.waitFor();
    const version = await card.locator('span[title]').first().getAttribute('title');
    check(Boolean(version), '卡片缺少实际版本');
    await card.getByTitle('版本', { exact: true }).click();
    await card.getByText(version + ' · 当前', { exact: true }).waitFor(); await shot('version', card);
    await card.getByRole('button', { name: '管理', exact: true }).click();
    await card.getByText('运行管理', { exact: true }).waitFor();
    check(await card.getByTitle('日志', { exact: true }).isVisible(), '实例没有日志入口');
    await shot('instance', card);
    await card.getByTitle('版本', { exact: true }).click(); await card.getByTitle('版本', { exact: true }).click();
    await card.getByText(version + ' · 当前', { exact: true }).waitFor(); await shot('reopened', card);
    return [`版本面板当前版本 ${version} 与卡片一致，关闭再打开仍正常。`, '实际展开运行管理并核对实例及日志入口，未执行回滚、删除或清除密钥。'];
  },
};
