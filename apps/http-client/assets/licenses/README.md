# 开源来源与许可证

本 App 使用原生 Node `fetch`、AbortController 与流式响应读取。HTTP 请求编辑、鉴权和响应分区参考 [Hoppscotch](https://github.com/hoppscotch/hoppscotch) 的常见交互；未复制其源码、组件或资源，不依赖其云端服务。

Moss App 代码采用 MIT。运行依赖包括 MIT 的 React / React DOM、jsonc-parser，以及 ISC 的 lucide-react。构建时递归收集实际依赖许可证，输出到安装包中的 `dist/licenses/THIRD_PARTY_NOTICES.txt`。

JSON 显示使用 jsonc-parser 编辑原文，避免把大整数转换为 JavaScript Number。Moss SDK 由本仓库固定引用的 Core 子模块提供，直接编入 Backend。
