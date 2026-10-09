# 更新记录

## 0.1.3

- Host 协议统一声明在 `host.protocols`，供 UI 和 Backend 共用。
- 同步 SDK 3 调用保障、契约校验和错误语义。

## 0.1.2

- 适配 Host API 3：使用绑定当前 App 的 SDK，统一调用取消及错误处理。

## 0.1.1

- 移除四项 AI 工具注册，时间戳、Base64、AES 和 JSON 功能仅通过 App 页面使用。

## 0.1.0

- 新增独立开发工具 App：时间戳双向转换、UTF-8 / URL-safe Base64、AES-GCM/CBC、JSON 格式化与校验。
- 提供示例、当前时间、单项复制、随机密钥和自动 IV，修改输入后清除旧结果。
- JSON 保留大整数精度，错误给出行列位置；AES 支持常见原始密钥与密文编码。
- 跟随 Moss 外观，适配窄窗口；四项能力同时提供给 Moss AI，Backend 按需启动。
