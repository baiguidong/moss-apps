# TAKT 工作流创作（Moss 0.2）

创建与运行由当前 Moss 会话完成，普通 Agent 调用继承当前会话的模型、工具和权限。保存不会运行；用户明确要求「创建并运行」时，保存后可立即调用 takt_run。不要为此创建新密钥、调用外部 CLI 或修改 Moss 设置。

首版接受 TAKT YAML 的内联子集。顶层：name（英文标识）、description、initial_step、max_steps（1–64，必填，总执行步数而非循环轮数）、steps。节点：name、description、persona（内联角色文字）、instruction（内联任务文字）、rules、pass_previous_response、session（continue/refresh）。所有名称唯一；next 指向另一个顶层节点、COMPLETE 或 ABORT。规则的 condition 是自然语言状态标签或 TAKT 条件表达式。流程的预算还受 Moss 任务限制。

```yaml
name: analyze-review
description: 分析需求并审查结果
max_steps: 8
steps:
  - name: analyze
    description: 需求分析
    persona: 你负责分析需求并形成清楚的建议。
    instruction: 根据用户任务给出分析，结合上一次审查意见修正。
    rules:
      - condition: 分析完成
        next: review
  - name: review
    description: 审查
    instruction: 审查上一步结果，明确判断通过或需要修改，并给出原因。
    rules:
      - condition: 审查通过
        next: COMPLETE
      - condition: 需要修改
        next: analyze
```

静态并行：父节点声明 parallel 数组及 rules，可设 concurrency 1–4，不声明 instruction/persona/session。parallel 中放 2–4 个普通 Agent 子节点；子节点 rules 的 next 只能为 COMPLETE/ABORT。父节点可用 `all("通过")`、`any("需修改")` 等 TAKT 聚合条件，标签须与子节点条件一致。不要让两条分支同时改同一个文件。

首版不支持外部 persona/instruction 引用、subworkflow、system/command 节点、runtime、provider/model、MCP 配置、edit、输出契约文件、定时任务或精确断点恢复。未知字段会被拒绝。用普通 Agent 的 instruction 描述汇总任务；通过 Moss 工具处理业务。优先使用小流程验证，再扩大步骤数量。

修改时先 takt_read/get，传 baseRevision 和完整 YAML 保存。启动指定 revision，task 填本次具体任务。takt_read/run 查看状态、图、每次节点访问和结果；大结果通过 resourceRef 读取。不要把进度查询变成重复运行，不把 max_steps 描述为无损恢复或精确重试保证。

可用运行控制：pause 等待在途调用完成后停止新的 Agent 派发；resume 仅继续当前 Moss 进程内暂停的 run；input 通过 text 给后续步骤补充要求，不改写已开始的调用；cancel 停止；rerun 创建新运行。暂停和等待仍受总时长与预算限制。查询修订用 takt_read/revisions，复制用 takt_copy，归档/恢复只在用户明确要求时用 takt_archive。
