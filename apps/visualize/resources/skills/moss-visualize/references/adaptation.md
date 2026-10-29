# 与 Codex visualize 1.0.49 的适配差异

这是一份保留创作意图的中文适配版，不是逐字翻译或 Codex 运行时的完整移植。原版的内容选择、克制布局、主题、图表、地图、交互和无障碍原则在 SKILL.md 与 design.md 中保留。以下区别属于宿主能力，不能声称完全相同：

| 原版 | Moss |
| --- | --- |
| 持久 HTML 文件 + visualize 引用标记 | App 持久任务资源 + 实际 result.displayMarkdown；不依赖临时路径 |
| wide 模式，普通约 736px/宽版约 1024px | 宿主决定消息与右侧宽度；暂无 wide 参数，必须响应式重排 |
| window.openai.widgetState、setWidgetState、openai:set_globals | mossVisualization.getState/setState 和 moss:state；上限仍为 16 KiB，不自动发起轮次 |
| modelContent/privateContent 分层 | 当前仅一个 JSON 状态，提交标注时可能全部提供给模型；不保存秘密或仅供 UI 私用的数据 |
| sendFollowUpMessage 确认对话框 | requestFollowUp 在选中位置打开宿主输入框，用户发送后直接进入当前主会话队列；常规修改使用宿主标注 |
| CDN 白名单、D3、运行时主题变量、工具样式、Lucide、viz-calendar、自动 tabs/tooltip | 当前沙箱无这些预置能力且阻止联网；自包含原生 HTML/CSS/SVG/JS 实现同样的设计要求，必要的已核实数据/库/图标在制作阶段内嵌 |
| render.py 包装、导出到指定目录 | App 导出实际成果；独立 HTML 可运行，宿主功能按有无 API 降级 |
| 静默工作、不播报进度 | 遵守 Moss 会话的上层进度要求；最终展示引用仍只在最终回复出现 |

原版样式类的几何、配色、字号、交互效果不能仅靠复制类名获得。这里用明确的原生布局和无障碍要求替代，不承诺原版样式库的像素一致效果。原版以版本固定的 D3/d3-geo 处理复杂图与投影；Moss 页面不能直接加载 CDN。没有合适的已核实投影或数据时，不用手绘地理轮廓冒充。
