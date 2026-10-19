// Keep observation tools available, but use one Playwright program for related
// actions instead of paying for a model turn after every click and keystroke.
export const disabledBrowserTools = [
  'browser_navigate', 'browser_close', 'browser_install',
  'browser_click', 'browser_type', 'browser_fill_form', 'browser_select_option',
  'browser_hover', 'browser_drag', 'browser_press_key', 'browser_press_sequentially',
  'browser_keydown', 'browser_keyup', 'browser_wait_for', 'browser_find',
  'browser_evaluate',
];

export function executionGuide(run) {
  const first = run.caseIndex === undefined || run.caseIndex === 0;
  return [
    first
      ? '先使用当前工具列表里 moss_test_browser 的 browser_run_code_unsafe、browser_snapshot、browser_tabs、browser_take_screenshot；工具已可用时直接调用。仅在未加载时用 ToolSearch 搜索 moss_test_browser，一次加载所需工具。完整工具名以当前列表为准，SDK 模式可能没有 mcp__ 前缀。提供的批处理脚本会自行选择本轮主页面；没有脚本或页面不匹配时再列出页面选择，不能创建空白页。'
      : '复用上一项已加载的工具、浏览器连接和页面。不要重新 ToolSearch、列出全部页面或重复读取自测清单。只有打开新窗口或页面不匹配时才重新选择测试页面。',
    '通过 browser_run_code_unsafe 的 async (page) => { ... } 批量完成真实界面操作。先观察未知界面，再将已确定的连续点击、输入、条件等待、DOM 断言和截图放在同一段代码中。普通界面项通常只需一次观察、一次或少量批处理、一次结果提交；复杂项按页面阶段分批，不能为了减少调用跳过验证。单击、输入、固定等待等零散工具已停用。',
    '优先 page.getByRole(role, { name, exact: true })、getByLabel、getByPlaceholder，并将查找限定到实际观察到的区域。每次操作默认 timeout: 5000；找不到元素就返回局部 DOM/ariaSnapshot 重新定位，不要猜多层 CSS 或复用失效的 e123 引用。页面文字和列表检查只返回相关区域、可见状态与少量结构化结果，不要每次点击都做全页快照。',
    '等待使用 locator.waitFor({ state: "visible", timeout: 45000 }) 或 waitForFunction 的实际条件，条件满足立即继续。不要用 sleep、setTimeout、waitForTimeout 或 browser_wait_for.time；time 是固定延迟，不是超时上限。长任务一次等待最多 45 秒，尚未完成时返回当前可见进度，再继续条件等待，总上限遵循本项清单。',
    '聊天必须同时验证 assistant 消息中的本轮标记和生成结束的界面状态。用户消息、输入草稿、工具参数中的相同标记不算回复；不要只对 body.getByText(marker) 等待。只读 DOM 可用 evaluate，不得调用 window.agentDesktop、IPC、内部状态或直接写存储替代点击。',
    `截图可直接合并进批处理：await page.screenshot({ path: ${JSON.stringify(`${run.evidenceDir}/${run.cases[0]?.id || 'case'}.png`)}, animations: 'disabled' })，返回截图路径和真实检查结果。每个需要对照的状态保存一张；截图需要视觉判断时用 browser_take_screenshot 查看。截图前先验证页面状态。`,
    '批处理示例（名称仅为示例，须按实际页面调整）：async (page) => { const button = page.getByRole("button", { name: "设置", exact: true }); await button.click({ timeout: 5000 }); const heading = page.getByRole("heading", { name: "外观", exact: true }); await heading.waitFor({ state: "visible", timeout: 5000 }); return { visible: await heading.isVisible(), text: await heading.innerText() }; }。',
  ].join('\n\n');
}
