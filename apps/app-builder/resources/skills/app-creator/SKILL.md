---
name: app-creator
description: 创建或迭代 Moss App，接入工具、技能、MCP、资源和成果展示，使用绑定源码、固定 SDK、构建预览与安装回执。只编写技能说明时改用内置 skill-creator。
---

# 应用创建与迭代

在当前主会话执行，先发现 builder_inspect、builder_prepare、builder_build、builder_preview、builder_release。全局按需工具可用 ToolSearch 查找，不要求用户先进入 App。

读取 builder_inspect operation=guidance 的当前指引和模板，再查询 Host info 与相关 contracts。判断用户需求是否需要 App；纯流程说明使用内置 skill-creator，安装技能使用 skill-installer。

默认通过主会话使用工具、在右侧成果区展示结果。只需介绍、配置和能力目录时采用 Core 通用详情，无需自建 UI；真实业务工作台才声明页面。保留已有 App 的业务 UI、数据、凭据、身份与固定 SDK。

新建用 builder_prepare operation=project、intent=create；编辑恢复 targetRef/draftRef 或已有 projectRef，不重建丢失的源码。文件操作在返回的绑定项目中进行。使用导出 SDK，不下载 latest 或依赖 Core 私有模块。

生成完整 Manifest、声明的入口/Schema/资源及可重建源码。实现用户功能后，检查源码哈希，构建并轮询回执；在固定产物上测试 Backend，必要时用真实 UI 预览或 CDP。只把实际通过的项目写为已验证。

用户已要求安装时使用 release.prepare/commit/get，读取结果；更新递增版本并携带基础版本和安装修订号。创建请求不自动发布公共市场。最终说明结果、测试范围、调用示例及尚缺的外部配置。
