export async function openMoreView(page, name) {
  await page.getByRole('button', { name: '更多功能', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

export async function resourceCheck({ page, shot, check, marker }, label) {
  await page.getByRole('button', { name: /技能.*专家.*连接器/ }).click();
  await page.getByRole('tablist', { name: '连接器分类', exact: true }).getByRole('tab', { name: label, exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: label, exact: true });
  await panel.getByRole('button', { name: label === '技能' ? /^已安装/ : /^我安装的/ }).click();
  const search = panel.getByPlaceholder('搜索已安装' + label, { exact: true });
  await search.waitFor();
  await panel.getByText(/^(加载中\.\.\.|加载已安装专家)$/).waitFor({ state: 'hidden', timeout: 15000 });
  const titles = panel.locator('div[title].font-semibold');
  const before = await titles.allTextContents();
  if (!before.length) await panel.getByText(label === '连接器' ? '没有找到匹配的连接器' : '暂无已安装' + label, { exact: true }).waitFor();
  await shot('installed', panel);
  let detail = '当前无已安装条目，已核对明确空状态。';
  if (before.length) {
    const name = before[0].trim();
    await search.fill(name);
    await titles.filter({ hasText: name }).first().waitFor();
    const after = await titles.allTextContents();
    check(after.every(value => value.includes(name)), '搜索混入不匹配名称，需要核对描述匹配');
    const card = titles.filter({ hasText: name }).first().locator('../../..');
    check((await card.innerText()).trim().length > name.length, '资源卡片缺少详情');
    await shot('detail', card);
    detail = `搜索 ${name} 命中，已查看已安装卡片中的描述等详情；当前卡片没有独立详情入口。`;
  }
  await search.fill('NO_RESOURCE_' + marker.split(' ')[1].slice(0, 8));
  await panel.getByText(label === '连接器' ? '没有找到匹配的连接器' : '暂无已安装' + label, { exact: true }).waitFor();
  check(await titles.count() === 0, '无匹配搜索仍有卡片');
  await shot('empty', panel);
  await search.fill('');
  if (before.length) await titles.first().waitFor();
  check(await titles.count() === before.length, '清空后列表数量未恢复');
  await shot('restored', panel);
  return [`已安装${label}列表加载完成，共 ${before.length} 个；没有使用市场列表。`, detail + '无匹配搜索与清空恢复正常，未触发安装、登录或授权。'];
}

export const extraRecipes = {
  'chat-stop': async ({ page, input, shot, check, marker }) => {
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    await input().fill(marker + ' 请详细列出 100 个软件测试场景，每个场景解释 100 字。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const stop = page.getByRole('button', { name: '停止', exact: true });
    await stop.waitFor({ timeout: 15000 });
    check(await stop.isEnabled(), '未捕获可停止的生成窗口');
    await shot('generating'); await stop.click();
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 15000 });
    await shot('stopped');
    await input().fill('请只回复 STOP_RECOVERED');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.locator('[data-message-body="assistant"]').filter({ hasText: 'STOP_RECOVERED' }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 60000 });
    await shot('recovered');
    return ['实际生成中停止按钮可用；已点击并等待生成状态退出，保存前后截图。', '停止后重新发送，真实 assistant 回复包含 STOP_RECOVERED，输入区恢复。'];
  },
  'model-selector': async ({ page, fixture, shot, check }) => {
    await fixture();
    const trigger = page.getByRole('button', { name: /^推理强度：/ });
    await trigger.click();
    const slider = page.getByRole('slider', { name: '当前会话推理强度', exact: true });
    await slider.waitFor();
    const initial = await slider.getAttribute('aria-valuenow');
    const max = await slider.getAttribute('aria-valuemax');
    check(Number(max) > 0 && await slider.isEnabled(), '模型没有可修改的多个推理强度');
    await shot('initial', page.getByRole('dialog'));
    await slider.focus(); await page.keyboard.press(initial === '0' ? 'End' : 'Home');
    const changed = initial === '0' ? max : '0';
    await page.getByText('正在应用…', { exact: true }).waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape'); await trigger.click();
    await page.locator('[role="slider"][aria-label="当前会话推理强度"][aria-valuenow="' + changed + '"]').waitFor();
    await shot('saved', page.getByRole('dialog'));
    await page.getByRole('button', { name: '恢复模型默认推理强度', exact: true }).click();
    await page.getByText('正在应用…', { exact: true }).waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape'); await trigger.click();
    await slider.waitFor(); check(await slider.getAttribute('aria-valuenow') === initial, '恢复后的强度不是样例会话原始模型默认值');
    await shot('restored', page.getByRole('dialog')); await page.keyboard.press('Escape');
    return ['会话推理强度弹层显示当前模型、滑块范围和当前值；已保存截图。', '已切换到另一支持值，关闭再打开保留；恢复模型默认并再次打开核对与初始默认一致。'];
  },
  'message-rendering': async ({ page, input, shot, check, marker }) => {
    await page.getByRole('button', { name: '新会话', exact: true }).click();
    const heading = 'MOSS_RENDER_' + marker.split(' ')[1].slice(0, 8);
    await input().fill(marker + ' 请在同一条回复输出 Markdown 标题 ' + heading + '、两行表格（A 240、B 240）、JavaScript 代码块 console.log("render-ok") 和两项列表，不调用工具。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const reply = page.locator('[data-message-body="assistant"]').filter({ hasText: heading });
    await reply.waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 60000 });
    await reply.getByRole('heading', { name: heading, exact: true }).waitFor();
    check(await reply.locator('table tr').count() >= 3, '实际 assistant 缺少两行表格');
    check(await reply.locator('li').count() >= 2, '实际 assistant 缺少两项列表');
    check((await reply.innerText()).includes('render-ok'), '实际 assistant 缺少要求的代码');
    await shot('rendered', reply);
    const expand = reply.getByRole('button', { name: /展开|收起/ });
    if (await expand.count()) { await expand.first().click(); await shot('toggled', reply); await expand.first().click(); }
    await shot('layout');
    return ['真实 assistant 消息包含渲染标题、两行数据表格、两项列表与 render-ok 代码，保存消息截图供视觉核对。', '已检查可用的展开收起入口，并保留整体布局截图；输入区可用。'];
  },
  'preview-pdf': async ({ preview, nativePdf, evidence, check }) => {
    check(typeof nativePdf === 'function', '需要原生 PDF 查看器检查能力，外层 DOM 不能验证 PDF 内容。');
    await preview('self-test-preview.pdf', async page => {
      await page.locator('webview').waitFor({ state: 'attached' });
      const source = await page.locator('webview').getAttribute('src');
      const result = await nativePdf(decodeURIComponent(new URL(source).pathname));
      evidence.push(...result.evidence);
      check(!result.error, result.error);
    });
    return ['原生 PDF 查看器页码已就绪；实际内容截图供 AI 核对单页文字与 Total 580。', '已点击原生放大控件并核对缩放数值改变，保存缩放后截图；关闭后工作区可用。'];
  },
  'permission-selector': async ({ page, fixture, shot, check }) => {
    await fixture();
    const selector = page.getByTitle('选择权限模式', { exact: true });
    let canceledConfirmation = false;
    const closeMenu = async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('menu').waitFor({ state: 'hidden' });
    };
    const select = async name => {
      const before = await selector.innerText();
      await selector.click();
      await page.getByRole('menu').waitFor();
      // Keyboard selection is stable while the popup animates above a bottom
      // composer. Its item may unmount on keydown, so send keyup via the page.
      await page.getByRole('menuitemradio').filter({ hasText: name }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menu').waitFor({ state: 'hidden' });
      if (name === '完全放行') {
        const confirmation = page.getByRole('dialog', { name: '启用完全放行？', exact: true });
        if (await page.locator('dialog').count()) {
          await confirmation.waitFor();
          await shot('confirmation', confirmation);
          if (!canceledConfirmation) {
            await confirmation.getByRole('button', { name: '取消', exact: true }).click();
            await confirmation.waitFor({ state: 'hidden' });
            check(await selector.innerText() === before, '取消确认后权限模式发生改变');
            canceledConfirmation = true;
            await select(name);
            return;
          }
          await confirmation.getByRole('button', { name: '确定启用', exact: true }).click();
        }
      }
      await selector.filter({ hasText: name }).waitFor();
    };
    // Handle only the explicit native confirmation exercised by this case.
    const confirm = dialog => dialog.message().startsWith('完全放行会跳过') ? dialog.accept() : dialog.dismiss();
    page.on('dialog', confirm);
    try {
      await selector.click();
      check(await page.getByRole('menuitemradio').count() === 5, '权限模式数量不正确');
      await shot('menu', page.getByRole('menu'));
      await closeMenu();
      await select('默认询问');
      await selector.click();
      check(await page.getByRole('menuitemradio').filter({ hasText: '默认询问' }).getAttribute('aria-checked') === 'true', '选中状态未保存');
      await closeMenu();
      await fixture();
      check((await selector.innerText()).includes('默认询问'), '返回会话后模式未保留');
      await shot('persisted', selector);
    } finally {
      await closeMenu();
      if (!(await selector.innerText()).includes('完全放行')) await select('完全放行');
      page.off('dialog', confirm);
    }
    await shot('restored', selector);
    return ['实际检查 5 种模式，切换默认询问后按钮和菜单选中态一致。', '离开并返回会话后模式保留；' + (canceledConfirmation ? '确认框取消后权限不变，再明确确认后恢复完全放行。' : '已通过确认框恢复完全放行。')];
  },
  'workspace-refresh': async ({ page, fixture, preview, shot, check }) => {
    await fixture();
    const refresh = page.getByRole('button', { name: '刷新工作区', exact: true });
    await refresh.click();
    for (const name of ['self-test-note.txt', 'self-test-preview.md', 'self-test-data.csv']) await page.getByText(name, { exact: true }).waitFor();
    await page.waitForFunction(() => { const button = document.querySelector('button[aria-label="刷新工作区"]'); return button && !button.disabled; }, undefined, { timeout: 15000 });
    const search = page.getByRole('textbox', { name: '搜索工作区文件', exact: true });
    if (!(await search.isVisible())) await page.getByRole('button', { name: '搜索工作区文件', exact: true }).click();
    await search.fill('self-test-note');
    await page.getByText('self-test-note.txt', { exact: true }).waitFor();
    check(await page.getByText('self-test-data.csv', { exact: true }).count() === 0, '文件筛选未生效');
    await shot('search'); await search.fill('');
    await page.getByRole('button', { name: '收起右侧栏', exact: true }).click();
    await page.getByRole('button', { name: '展开右侧栏', exact: true }).click();
    await page.getByText('self-test-data.csv', { exact: true }).waitFor();
    await preview('self-test-note.txt', async p => { await p.getByText('Moss self-test fixture', { exact: false }).waitFor(); });
    await preview('self-test-preview.md', async p => {
      await p.getByRole('heading', { name: 'Moss Preview', exact: true }).waitFor();
      check(!(await p.locator('body').innerText()).includes('Moss self-test fixture'), '预览残留前一文件内容');
    });
    return ['刷新后 3 个样例存在，按文件名搜索命中且清空恢复。', '右栏收起再展开正常，两个文件分别显示对应预览，无前一文件残留。'];
  },
  'preview-svg': async ({ preview, shot, check }) => {
    await preview('self-test-image.svg', async p => {
      const image = p.getByRole('img', { name: 'self-test-image.svg', exact: true });
      await image.waitFor();
      const value = await image.evaluate(img => ({ loaded: img.complete && img.naturalWidth === 480 && img.naturalHeight === 240, src: img.src }));
      check(value.loaded, '图片未完成加载或尺寸错误');
      const svg = await image.evaluate(img => {
        const [header, data] = img.src.split(',');
        return header.endsWith(';base64') ? atob(data) : decodeURIComponent(data);
      });
      // Source is supplemental; the AI also checks the actual rendered screenshot.
      check(svg.includes('MOSS_IMAGE_PREVIEW') && svg.includes('#2563eb') && svg.includes('#22c55e'), '图片文字或颜色标记缺失');
      await shot('rendered', p);
      // The current image viewer fits to its container; resize the window to
      // exercise that public behavior instead of claiming nonexistent controls.
      const size = p.viewportSize() || await p.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      if (size) {
        try { await p.setViewportSize({ width: 720, height: 520 }); await image.waitFor(); await shot('fit', p); }
        finally { await p.setViewportSize(size); }
      } else await shot('fit', p);
      check(await image.evaluate(img => img.complete && img.clientWidth > 0 && img.clientHeight > 0), '适应窗口后图片丢失');
    });
    return ['图片元素加载完成，尺寸 480×240；截图供核对蓝色矩形、绿色圆和文字。', '图片按窗口适应显示，关闭后工作区可用；当前预览无独立缩放按钮。'];
  },
  'skills-hub': async context => context.resource('技能'),
  'experts-hub': async context => context.resource('专家'),
  'connectors-hub': async context => context.resource('连接器'),
  'agent-manager': async ({ page, settings, shot, check, marker }) => {
    await settings(); await page.locator('[data-settings-nav="agents"]:visible').click();
    const name = 'agent-' + marker.split(' ')[1].slice(0, 8), instruction = 'ROLE_INSTRUCTION_' + marker.split(' ')[1].slice(0, 8);
    await page.getByRole('button', { name: '创建 Agent', exact: true }).click();
    const nameField = page.getByPlaceholder('code-reviewer', { exact: true });
    const description = page.getByPlaceholder('例如：审查代码改动并指出风险', { exact: true });
    const prompt = page.getByPlaceholder('描述这个 Agent 的角色、工作方式和输出要求……', { exact: true });
    const tools = page.getByPlaceholder('Read, Grep, Bash', { exact: true });
    await nameField.fill(name); await description.fill('SELF_TEST_AGENT'); await prompt.fill(instruction); await tools.fill('Read');
    const form = page.getByRole('heading', { name: '创建 Agent', exact: true }).locator('../../..');
    await shot('form', form);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await nameField.waitFor({ state: 'hidden' });
    const row = page.getByText(name, { exact: true }).locator('../../..');
    await row.waitFor(); await shot('created', row);
    await row.getByTitle('编辑', { exact: true }).click();
    check(await tools.inputValue() === 'Read' && await prompt.inputValue() === instruction, 'Agent 工具或指令未保存');
    await description.fill('SELF_TEST_AGENT_EDITED');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await nameField.waitFor({ state: 'hidden' });
    await row.getByTitle('编辑', { exact: true }).click();
    check(await nameField.inputValue() === name && await description.inputValue() === 'SELF_TEST_AGENT_EDITED'
      && await prompt.inputValue() === instruction && await tools.inputValue() === 'Read', 'Agent 重开编辑内容不一致');
    await shot('reopened', page.getByRole('heading', { name: '编辑 Agent', exact: true }).locator('../../..'));
    await page.getByRole('button', { name: '取消', exact: true }).click();
    return [`已创建 ${name}，实际保存角色指令且工具仅 Read。`, '修改描述保存后重新打开，描述、名称、指令和工具配置一致。'];
  },
  'cron-list': async ({ page, more, shot, check }) => {
    await more('定时任务');
    const tabs = page.getByRole('tablist', { name: '定时任务位置', exact: true });
    const panel = page.getByRole('tabpanel');
    for (const label of ['本地', '云端', '本地']) {
      const tab = tabs.getByRole('tab', { name: label, exact: true }); await tab.click();
      await panel.getByText('加载中...', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 });
      check(await tab.getAttribute('aria-selected') === 'true', '任务位置未选中');
      const text = await panel.innerText();
      check(/暂无定时任务|下次|定时任务|云端连接|登录/.test(text), '任务位置没有列表或明确状态');
      if (label === '本地') check(!/加载失败|获取失败|Error/.test(text), '本地任务列表错误');
      await shot(label, panel);
    }
    return ['本地定时任务列表或明确空状态可读，无持续加载。', '已查看云端连接状态并返回本地，未执行任何任务。'];
  },
  'overview-usage': async ({ page, more, shot, check }) => {
    await more('概览');
    await page.getByRole('tablist', { name: '概览内容', exact: true }).getByRole('tab', { name: '使用概览', exact: true }).click();
    const local = page.getByRole('region', { name: '本地电脑用量', exact: true });
    await page.getByLabel('正在加载本地电脑用量', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 });
    const verify = async () => check(!/NaN|加载失败|错误|−\d|-\d/.test(await local.innerText()), '本地统计存在无效数据或错误');
    await verify(); await shot('local', local);
    const modes = page.getByRole('tablist', { name: 'Token 活动统计方式', exact: true });
    for (const label of ['每日', '每周', '累计']) {
      const tab = modes.getByRole('tab', { name: label, exact: true }); await tab.click();
      check(await tab.getAttribute('aria-selected') === 'true', '统计方式未选中');
      await page.getByLabel(label === '每日' ? '每日 Token 活动热力图' : label + ' Token 活动', { exact: true }).waitFor();
      await shot(label, modes.locator('../..'));
    }
    await page.getByRole('button', { name: '刷新概览', exact: true }).click();
    await page.getByLabel('正在加载本地电脑用量', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 });
    await verify();
    return ['本地用量加载完成，未出现 NaN、负数或加载错误。', '每日、每周、累计选中态和图表一致；已实际刷新并复核本地统计。'];
  },
  'resource-monitor': async ({ page, more, shot, check }) => {
    await more('概览');
    await page.getByRole('tablist', { name: '概览内容', exact: true }).getByRole('tab', { name: '资源监控', exact: true }).click();
    const metric = page.getByRole('group', { name: '监控指标', exact: true });
    await metric.waitFor({ timeout: 15000 });
    const table = page.getByRole('table');
    await table.waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('tbody tr')).some(row => /^\d+(\.\d+)?%$/.test(row.children[2]?.textContent.trim() || '')), undefined, { timeout: 15000 });
    const values = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => [row.children[2]?.textContent.trim(), row.children[3]?.textContent.trim()]));
    check(values.every(([cpu, memory]) => (cpu === '—' || /^\d+(\.\d+)?%$/.test(cpu)) && (memory === '—' || /^\d+(\.\d+)?\s*(?:[KMGT]i?)?B$/.test(memory))), '进程 CPU/内存数值或单位无效：' + JSON.stringify(values));
    check(await table.getByRole('row').count() > 1 || /没有|暂无/.test(await table.innerText()), '进程表缺少数据或空状态');
    for (const label of ['CPU', '内存']) {
      const button = metric.getByRole('button', { name: label, exact: true }); await button.click();
      check(await button.getAttribute('aria-pressed') === 'true', '监控指标未切换');
      await page.getByRole('heading', { name: label === 'CPU' ? 'CPU 实时趋势' : '内存变化', exact: true }).waitFor();
      await shot(label);
    }
    const filter = page.getByRole('group', { name: '进程筛选', exact: true });
    await filter.evaluate(node => node.scrollIntoView({ block: 'start' }));
    await shot('process-list');
    await filter.getByRole('button', { name: 'App', exact: true }).click();
    check(await filter.getByRole('button', { name: 'App', exact: true }).getAttribute('aria-pressed') === 'true', '进程筛选未生效');
    await shot('app-processes');
    await filter.getByRole('button', { name: '全部', exact: true }).click();
    return ['CPU/内存趋势和进程表已加载，截图供核对数据与单位。', '已切换 CPU/内存和 App/全部筛选，未结束或重启进程。'];
  },
  'memory-overview': async ({ page, more, shot, check, marker }) => {
    await more('概览');
    const tabs = page.getByRole('tablist', { name: '概览内容', exact: true });
    const visited = [];
    for (const label of ['全局记忆', '项目记忆', '会话摘要']) {
      const tab = tabs.getByRole('tab', { name: label, exact: true });
      if (!(await tab.count()) && label === '会话摘要') continue;
      await tab.click();
      check(await tab.getAttribute('aria-selected') === 'true', '记忆范围未切换');
      const search = page.getByRole('textbox', { name: '搜索记忆', exact: true });
      await search.waitFor();
      await page.getByLabel('正在加载记忆', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 });
      const area = search.locator('xpath=ancestor::section[1]');
      check(!/加载失败|NaN/.test(await area.innerText()), '记忆范围加载错误');
      const entries = area.locator('aside').getByRole('button');
      const before = await entries.allTextContents();
      if (await entries.count()) {
        await entries.first().click();
        await page.getByLabel('正在加载记忆', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 });
        check((await area.locator('article').innerText()).trim().length > 0, '记忆详情为空');
      }
      await shot(label); visited.push(label);
      await search.fill('NO_MEMORY_' + marker.split(' ')[1].slice(0, 8));
      await entries.first().waitFor({ state: 'hidden' });
      check(/没有匹配|暂无/.test(await area.locator('aside').innerText()), '无匹配记忆搜索没有明确空状态');
      await shot(label + '-search');
      await search.fill('');
      if (before.length) await entries.first().waitFor();
      check(JSON.stringify(await entries.allTextContents()) === JSON.stringify(before), '清空搜索后记忆列表未恢复');
      check(await tab.getAttribute('aria-selected') === 'true', '搜索返回后范围丢失');
    }
    return ['已切换并核对选中态：' + visited.join('、') + '；截图记录条目或空状态。', '各范围搜索后清空可用，未删除记忆或触发 Dream；有条目的详情仍由 AI 对照截图核对。'];
  },
  notifications: async ({ page, shot, check }) => {
    const button = page.getByRole('button', { name: /^消息中心/ });
    for (let i = 0; i < 2; i++) {
      await button.click();
      const panel = page.getByRole('dialog', { name: '消息中心', exact: true });
      await panel.waitFor();
      const text = await panel.innerText();
      check(text.includes('暂无消息'), '当前有通知，需要 AI 检查本轮通知及其跳转');
      await shot(i ? 'reopened' : 'opened', panel);
      await panel.getByRole('button', { name: '关闭消息中心', exact: true }).click();
      await panel.waitFor({ state: 'hidden' });
    }
    return ['消息中心显示明确空状态。', '关闭并再次打开正常；无本轮通知，未将跳转记为已执行。'];
  },
};
