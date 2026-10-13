# Changelog

## 0.2.0

支持 Windows 10/11 x64 和 Mac Intel；按 Windows x64、Mac Apple Silicon、Mac Intel 独立构建及签名。市场自动下载对应平台安装包，安装器校验签名绑定的平台。需要 Host API 3.3。

Windows 接入 UI Automation、窗口截图、点击、中文输入和快捷键；按真实进程路径识别授权目标，校验进程创建时间；增加 invoke/expand 与 win 修饰键。设置页显示 Windows 系统能力，保留 Moss 外观联动。源码包记录构建平台，CI 汇集已验证的各平台产物后统一发布。

## 0.1.1

设置页接入 Moss 外观设置及实时事件，统一颜色、字体、按钮、边框和四种背景；补齐窄屏布局。签名校验失败时显示可操作的中文提示，避免停留在连接状态。提供受 Host 信任的签名安装包。

## 0.1.0

从 Moss Core 迁移电脑操控。保留 Cua 0.34.0 的窗口观察与控制能力，独立提供设置和驱动依赖。
