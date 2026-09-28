# 开源来源

功能组织参考 Ctool（https://github.com/baiy/Ctool，MIT）和 OmniTools（https://github.com/iib0011/omni-tools，MIT）的开发工具分类与使用方式。本 App 的界面与工具适配实现由 Moss 编写，未复制这两个项目的源码或引入其依赖树。

JSON 处理使用 Microsoft jsonc-parser（MIT），按原始 token 格式化，避免转换为 JavaScript 数值时丢失大整数精度。AES 使用浏览器与 Node 的原生 Web Crypto；Base64 和时间处理使用标准 API。

UI 使用 React、React DOM、Lucide。构建时收集这些依赖、Moss SDK 的第三方运行依赖及其传递依赖许可证，安装包中的 `dist/licenses/THIRD_PARTY_NOTICES.txt` 保存完整内容。
