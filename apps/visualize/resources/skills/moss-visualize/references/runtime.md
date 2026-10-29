# Moss 交互展示协议 v1

App 可以携带 skill、参考说明和界面模板。模型生成的 HTML 是任务成果，宿主负责在消息中及右侧成果区运行；不需要 App 自己的 UI 入口。

片段使用内联 CSS/JS，所有资源内嵌。没有 Node、宿主文件系统、外层 DOM 或直接模型调用接口；CSP 限制外部资源加载和 fetch 等连接。普通 DOM、SVG、Canvas 可用。不要生成 require/import、外部脚本、fetch、子 iframe、页面跳转或提交表单；按钮明确 type="button"。

样式使用 light-dark() 或 prefers-color-scheme，背景和文字保持可读。宿主同步明暗主题。适配 320px 窄窗，图表包含单位，重要控件可用键盘，动画尊重 prefers-reduced-motion。主交互必须实际改变结果。正文不展示工具名和实现细节。

宿主在内容执行前注入 `window.mossVisualization`：

- `getState()`：读取当前会话、当前作品版本的交互状态；可能为 null。
- `setState(json)`：保存不超过 16 KiB 的 JSON 状态，供关闭重开、消息/右侧同步和后续标注使用；没有 privateContent 分层，提交标注时整个状态可能提供给模型。只保存有意义的选择，不保存图片、秘密和可重新计算的大数据。不启动模型请求。
- `requestFollowUp(prompt)`：提出 1–4000 字的问题。宿主在触发位置打开可编辑的标注输入框；用户点击“发送标注”后直接进入当前主会话，忙碌时排队。页面调用本身不自动发送，也不改写主输入框草稿。
- 接收 `window` 的 `moss:state` 事件，`event.detail` 是其他展示位置更新的状态；同步本地控件与图形。事件处理中不要再次 setState，避免循环。

示例：

```js
const api = window.mossVisualization;
const saved = api?.getState();
const state = { rate: Number(saved?.rate ?? 5) };
function render() { /* 更新输入控件和计算结果 */ }
slider.addEventListener('input', () => {
  state.rate = Number(slider.value);
  render();
  api?.setState(state);
});
window.addEventListener('moss:state', event => {
  if (typeof event.detail?.rate === 'number') { state.rate = event.detail.rate; render(); }
});
// 仅在任务明确需要进一步调查所选数据时，才添加 requestFollowUp 操作。
render();
```

导出文件独立打开时仍可操作；宿主 API 不存在，隐藏或禁用“继续询问”按钮。代码需要用可选链检查 API。不要把空白页或未实现的交互描述为完成。

创建返回的 `result.presentation` 可以直接传给 Moss 的 moss_present 工具。它负责当前会话右侧动态展示，用户关闭跟随或固定成果时应尊重 deferred 返回。仅在最终回复渲染引用不意味着右侧已经打开。
