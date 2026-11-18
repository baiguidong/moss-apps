# Changelog

## 0.1.13

- 发布在线安装包和适配 Apple Silicon 的离线整包，应用市场可按目标平台下载离线资源。

## 0.1.12

- 首次准备可选择在线下载或使用同版本的离线包。首个离线包提供 macOS Apple Silicon、CPython 3.13 的全部引擎 wheels 和固定版本的多语言模型。

## 0.1.11

- 检索评测通过页内列表选择预期文档，修复 macOS Electron 窗口填写文档路径时进程退出的问题。

## 0.1.10

- 在准备页展示 Moss Python 状态，复用 App 私有环境启动检索引擎。
- 支持新建和编辑文本、从网页导入、按分类浏览、查找相似资料和移除库内副本。
- 新增全文及混合检索选项、证据片段复制、索引任务面板和检索质量评测。

## 0.1.9

- 修复检索引擎异常退出后，PID 被其他系统进程复用导致无法重新启动的问题。

## 0.1.8

- Rebuild against Moss Core 0.1.25 and refresh the shared appearance/runtime snapshot.

## 0.1.7

- Rebuild against Moss Core 0.1.24 and refresh the shared appearance/runtime snapshot.

## 0.1.6

- Rebuild against Moss Core 0.1.23 and refresh the shared appearance/runtime snapshot.

## 0.1.5

- 同步 Moss Core 外观设置、字体和主题变量。

## 0.1.4

- 区分显式准备时的模型下载与启动时的离线校验，并等待启动完成。


## 0.1.3

- 整合本次应用更新并重新验证桌面平台发布。

## 0.1.2

- 新增 Linux AMD64 支持，Python 引擎继续使用完整哈希锁定的跨平台依赖，首次准备时安装 Linux 原生 wheel。
