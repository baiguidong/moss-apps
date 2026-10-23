---
name: resume-ai-help
display_name: 简历 AI 帮你写
display_name_en: Resume AI Help Write
description: 用于用户请求优化或改写简历、上传整份简历生成优化简历、复现简历「AI 帮你写」两阶段追问与优化交互时触发。整份优化固定生成 HTML，单字段优化只返回该字段。
description_zh: 用于用户请求优化或改写简历、上传整份简历生成优化简历、复现简历「AI 帮你写」两阶段追问与优化交互时触发。整份优化固定生成 HTML，单字段优化只返回该字段。
description_en: Use when the user asks to optimize or rewrite a resume, upload a full resume to generate an optimized version, or reproduce the two-stage ask-and-optimize interaction for resume writing. A full-resume workflow ends in local HTML; a single-field workflow returns only that field.
category: 15-Education
version: 1.0.0
author: 上海高顿教育科技有限公司
agent_created: true
---

# 简历 AI 帮你写 Skill (Resume AI Help Write)

## Overview

本 skill 与服务端「AI 帮你写」两阶段异步链路保持一致：

| 环节 | 1:1 对应的 Java 方法 / 端点 |
|---|---|
| 追问生成（阶段 1） | `POST /api/v1/personal/resume/help/optimize` → `追问 prompt 入参装配` |
| 优化生成（阶段 2） | `POST /help/submit` → `#buildOptimizePromptParam`（含 `information` 拼接 `#buildQuestionParam`） |
| 输出解析 | `#parseGenerateQuestionResponse` / `#parseOptimizeResponse`（含 JSON 修复一次兜底语义） |
| 简历解析（复制自 resume-diagnosis） | `简历解析逻辑` → `scripts/resume_parse.py`（emit-template / finalize / extract-fields） |
| 简历导出 HTML（**本地渲染，不调接口**） | `渲染入参装配` + `#parseResume` → `scripts/render_resume_html.py`（模板用 export 服务同款 OSS HTML 原始件，Freemarker→Jinja2 机械转换） |
| 类型配置 | 服务端类型配置 → `references/field-config.json` |

**所有确定性逻辑由脚本强制执行**：`scripts/aihelp.py` 管两阶段链路（变量映射、空值填「无」、information 拼接、输出 JSON 校验），`scripts/resume_parse.py` 管整份简历解析；模型只做两件事：把渲染后的 prompt 发给 LLM、把用户答案收齐。

支持 **12 种模块/字段类型**，每种两个 prompt（追问 + 优化），全量配置见 `references/field-config.json`，速查：

| dataFieldCode（脚本入参） | 模块 | 追问 prompt | 优化 prompt |
|---|---|---|---|
| projectExperienceDesc | 项目经历 | 4244 | 4243 |
| workExperienceDesc | 工作经历 | 4248 | 4247 |
| internshipExperienceDesc | 实习经历 ⚠️wangsu-gpt-4o | 4235 | 4236 |
| practicalExperienceDesc | 实践经历 | 4246 | 4245 |
| campusActivitiesDesc | 校内工作 | 4238 | 4237 |
| competitionExperienceDesc | 比赛经历 | 4240 | 4239 |
| trainDesc | 培训经历 | 4242 | 4241 |
| hobbySpecialityDesc | 爱好特长 | 4222 | 4223 |
| applicationReasonDesc | 应聘理由 | 4224 | 4226 |
| selfEvaluationDesc | 自我评价 | 4227 | 4225 |
| careerPlanningDesc | 职业规划 | 4229 | 4228 |
| suitableJobDesc | 适合的工作 | 4231 | 4230 |

---

## 与 resume-diagnosis 的关系（相同部分**直接复制**，不引用）

| | resume-diagnosis（用户级 skill） | 本 skill |
|---|---|---|
| 业务方向 | 整份简历诊断打分（3 类诊断 + 6 维评分 + 报告） | 单字段「AI 帮你写」改写（追问 → 优化） |
| prompt 资产 | 12 份字段诊断 prompt + 评分 prompt 1640；user 消息传字段值 | 24 个 prompt（4222-4248）；user 恒为固定串，变量全在 systemPrompt |
| 追问交互 | 无（一次性出报告） | **有**（阶段 1 生成 3 个填空式追问，答案拼进优化 prompt 的 `information`） |
| 简历解析 | `analysisResume` 1:1 | **完全相同 → 已直接复制进本 skill，自包含，不依赖 resume-diagnosis 的任何文件** |

复制清单（与 resume-diagnosis 对应文件逐字一致；禁止改成引用对方路径）：

- `scripts/resume_parse.py` — 复制其 `resume_pipeline.py` 的**解析部分**（emit-template + finalize 的清洗/归一化/状态判定/模块排序）；诊断专属部分（NO_FILL / NO_DATA / 6 维评分 / build-report / resume-score-config 依赖）已剔除；新增 `extract-fields` 子命令把解析结果转成 `aihelp.py render --fields` 入参。
- `scripts/extract_spire.py` / `scripts/extract_doc_text.py` — .doc 原文提取，逐字复制。
- `references/resume-module-config.json` — 模块+字段权威配置（4 种 resumeType 全量 + visibleModuleMap），逐字复制。
- `references/analysis-resume-rules.md` / `references/resume-schema.md` — 解析规则与配置阅读辅助，逐字复制。

**同步纪律**：服务端解析逻辑（`analysisResume` / `简历模块配置.json`）变更时，两个 skill 的对应文件都要更新；`resume_parse.py` 的 emit-template / finalize 输出必须与 resume-diagnosis 对拍一致（对拍方法见本文件「局限与免责」前的工作流验证）。

---

## 触发场景（When to use this skill）

- 用户想优化简历某一段："帮我把这段工作经历用 AI 优化一下"、"自我评价帮我写写"、"项目描述太干了"。
- 用户上传整份简历文件/全文，想优化其中某一段（先走 Phase 0.5 解析，再进两阶段）。
- 用户想体验/复现「AI 帮你写」的追问 → 优化两阶段交互。
- 用户上传整份简历并要求优化、生成最终简历或排版：完成字段优化后自动进入 Phase 5，固定生成 HTML。
- 测试/改动分析："AI 帮你写影响哪些接口"、"promptId 4235 是哪个"、"加一种新的优化类型要动哪里"、"实习经历优化效果变差了查一下"。
- **不适用**于：整份简历诊断打分（用 `resume-diagnosis`）；面试刷题（用 `interview-brush`）。

### 无歧义默认入口（最高优先级）

用户已经提供整份简历（附件或全文）并说“简历优化”“帮我优化简历”“生成优化简历”等泛化请求时，意图已经充分：**默认且立即执行整份优化并生成 HTML**。**禁止询问“希望怎么优化”**，不得提供“整份重写 / 诊断 / 重点字段”选项，不得要求用户再次确认范围、产物格式或模板。

- 只有用户明确说“只改某段/某字段/某条经历”时，才缩小为单字段流程。
- 不得推荐或切换到 `resume-diagnosis`；诊断只在用户明确要求“诊断、评分、问题报告”时适用。
- 后续唯一允许的内容型交互是：目标岗位原文缺失时询问一次，以及每个字段追问阶段展示可跳过的 3 个追问。

---

## 模式 A：本地复跑两阶段链路（Workflow）

### Phase 0：前置信息收集

先判断输入范围：整份简历请求直接进入 Phase 0.5，不收集单个 `dataFieldCode`；只有用户明确限定某字段时才按下表收集。不得为了让用户选择优化范围而停住流程。

需要 2 类输入（缺什么问什么，最多各问 1 次）：

| 变量 | 来源 | 兜底 |
|---|---|---|
| `dataFieldCode` 优化类型 | 用户指定模块 | 按用户给的内容推断（如"这段工作经历"→`workExperienceDesc`），拿不准用 `python scripts/aihelp.py show --type <code>` 核对 |
| `fields` 字段值 | 用户粘贴的简历内容，或 Phase 0.5 解析产出 | 至少要有描述正文字段（如 `workExperienceDesc`）；`position`（求职意向）强烈建议问，它映射为所有 prompt 的 `job` 变量 |

`fields` 的 key 取 `field-config.json` 里该类型 `variableMappings` 的**左侧请求字段**（如 workExperience → `position/workCompanyName/workDepartmentName/workPostName/workExperienceDesc`）。用户没给的字段不要编造，脚本会自动填「无」。

### Phase 0.5：整份简历解析（输入是完整简历文件/全文时；与 resume-diagnosis 完全一致的复制实现）

用户直接粘贴目标字段内容时**跳过本 Phase**。输入是整份简历时：

1. **读原文**：附件先用 Read 工具读为文本；`.doc` 旧版二进制用提取脚本（输入路径 = 用户实际上传的文件）：

```bash
python scripts/extract_spire.py "<用户上传的.doc路径>"        # 优先，依赖 pip install Spire.Doc
python scripts/extract_doc_text.py "<用户上传的.doc路径>"     # 兜底
```

2. **生成逐字段模板**：`resumeType` 是内部数据结构，不是输出格式，必须根据原文自动推断，**不得让用户选择 `resumeType`**：有正式工作经历用 `havingWorkExperience`；无正式工作但有实习用 `havingInternshipExperience`；两者都没有用 `noInternshipExperience`；仅当用户明确说是网申表时用 `onlineApplication`。脚本参数只接受这些枚举键，不得传数据库数值别名 `0/1/2/3`，否则会触发 `KeyError`。

```bash
python scripts/resume_parse.py emit-template --resume-type <resumeType枚举键> --out -
```

3. **模型填值**：逐字段照抄原文，一个字段都不许跳过；经历类模块按原文条数增加 `records` 元素；时间照抄原文，归一化由脚本完成。填值纪律与 `references/analysis-resume-rules.md` §9/§10 完全一致。

4. **确定性解析**（清洗/归一化/状态/排序全由脚本完成）：

```bash
python scripts/resume_parse.py finalize --resume-type <resumeType枚举键> --filled - --out - <<'JSON'
<模型填好的 filled JSON>
JSON
```

5. **提取 AI 帮你写入参**：`moduleCode` 取 `field-config.json` 里该类型的 `moduleCode`；`--with` 追加 variableMappings 中不属于目标模块的请求字段（通常是 `position`）：

```bash
python scripts/resume_parse.py extract-fields --finalized - --module <moduleCode> \
  --data-sort <用户要优化第几条经历，默认1> --with position --out -
```

输出 JSON 即为 Phase 1 的 `--fields` 入参（多余 key 会被 render 忽略，缺 key 自动填「无」）。

### Phase 0.6：整份简历编排（本地扩展）

**执行铁律：整份简历必须使用 `scripts/full_resume_runner.py`。** 禁止由模型自行维护循环下标、凭记忆决定下一字段，或在对话中临时拼装 `overrides.json`。单字段请求仍可直接使用 `aihelp.py`。

runner 将 `field-config.json` 的类型顺序作为唯一顺序，同一经历模块再按 `dataSort` 升序；它一次只返回一个动作：`ask`、`optimize` 或 `render_html`。当前动作没有落盘前不能进入下一项；仍有未处理项目，runner 会禁止提前生成 HTML。`init` 直接把每个字段置为追问待答态，`next` 的第一个动作恒为 `ask`——与 服务端 `/optimize` 无条件调 promptOneId 1:1，不存在“先判断充分性再决定要不要追问”的分支。

```bash
python scripts/full_resume_runner.py init --finalized finalized.json \
  --state runner-state.json --overrides overrides.json
python scripts/full_resume_runner.py next --state runner-state.json

# ask 动作是硬停点：展示追问后必须结束当前回复，等待用户下一次输入
# 用户提供至少一个答案时落盘
python scripts/full_resume_runner.py answers --state runner-state.json --qa '<问答 JSON 数组>'
# 只有用户明确说“跳过/不回答/直接优化”时才能执行；不得把“用户尚未回答”解释为“全部跳过”
python scripts/full_resume_runner.py skip-questions --state runner-state.json --confirmed-by-user
# optimize 动作：把 LLM 原始 JSON 响应按 UTF-8 原样落盘；runner 内部强制调用 parse-opt，随后累计优化结果
python scripts/full_resume_runner.py complete --state runner-state.json --response-file optimization-response.json

# 重复 next，直到 action=render_html；只有此时才允许导出
python scripts/full_resume_runner.py render-html --state runner-state.json \
  --resume-name '<姓名的简历>' --out resume.html
```

用户明确跳过整个当前优化项时执行 `python scripts/full_resume_runner.py skip-item --state runner-state.json --confirmed-by-user`。`skip-questions` 只跳过问题、仍会优化字段；`skip-item` 才跳过字段，两者不得混用。状态与 overrides 都逐步持久化；模型调用失败或会话中断后继续执行 `next` 恢复，不得从第一项重跑。

优化正文禁止穿过 shell 参数边界：禁止用 `complete --resume`，也禁止把多行内容手工改写成 `\\n` 后拼接命令。必须将模型返回的 **LLM 原始 JSON** 直接写入独立 UTF-8 文件，再传 `--response-file`；文件中的 JSON 转义由解析器还原为真实换行。runner 会拒绝残留字面量 `\\n` / `\\r` 的结果，遇到报错应重新落盘原始响应，不得用字符替换猜测转义层数。

老功能是用户在某个字段上点一次「AI 帮你写」，本身不负责自动优化整份简历。为了支持“上传整份简历 → 优化 → HTML”，本 skill 在老功能外增加以下单会话编排，但每个字段内部仍严格复用 Phase 1-3：

1. 从 `baseInformation.position` 读取目标岗位；“识别岗位”只表示识别简历中明确写出的求职意向，不得根据专业或经历臆测岗位。原文没有目标岗位时只追问一次。
2. 根据 finalized.json 枚举 12 种受支持的 `moduleCode + dataFieldCode`，经历类模块的每条 record 按各自 `dataSort` 独立处理；空字段、HIDDEN 模块和 12 种配置以外的字段不调用 AI 帮你写。
3. 用户要求“整份优化”时，默认处理所有非空且受支持的描述字段；用户只点名某一模块时，仅处理该模块。不得把 `resumeType`、Word/PDF/HTML 当作优化类型。
4. 每个进入优化的字段无条件走两阶段（先生成追问、再优化），不判断原文充分性；每个成功结果按 `(moduleCode, dataSort, dataFieldCode)` **逐条累计到 `overrides.json`**，不得只保留最后一条。
5. 没有需要优化的字段、用户明确跳过全部字段优化，或用户只要求排版时，不调用 Phase 1-3，保留 finalized.json 原内容直接进入 Phase 5。

#### 每个字段无条件走两阶段（与 服务端 1:1）

服务端 `POST /optimize` 无条件调 promptOneId 生成 3 个追问，没有任何“先判断原文是否充分再决定要不要跑 promptOneId”的步骤。runner 1:1 对齐：`init` 直接把字段置为追问待答态，`next` 的第一个动作恒为 `ask`，**禁止**凭“原文够厚 / 有职责动词 / 已有数据 / 已覆盖核心结构”等任何主观判断跳过 promptOneId——哪怕原文只有一行、没有量化数据，也必须先生成追问、展示给用户。

追问是可选交互：即使追问已展示，**用户可全部跳过**，随后仍进入 Phase 3（`information` 自动填「无」，对应后端允许 `/submit` 不答直接优化）。但“可跳过”只表示用户拥有选择权：展示追问后必须结束当前回复并等待用户；用户尚未回复、当前消息没有答案或模型预计用户可能不答，都不得自动执行 `skip-questions`，只有用户明确说“跳过/不回答/直接优化”时才带 `--confirmed-by-user`。本 skill 不存在与后端混淆的本地充分性判断层；服务端的 `parseGenerateFromDto` 在真正调用 promptOne 时仍要求 `question1/2/3` 三项非空。

### Phase 1：追问（promptOneId，1:1）

对每个进入优化的字段无条件调用 promptOne（与 服务端 `/optimize` 1:1，不存在“信息已满足则跳过”分支）。调用后，后端协议要求生成 3 个非空追问；产品层允许用户部分或全部跳过。

```bash
python scripts/aihelp.py render --type <dataFieldCode> --stage ask --fields '<json>'
```

脚本输出 `systemPrompt`（原文已替换变量）+ `userContent`（**恒为** `开始，注意输出格式，注意输出格式`，不得改成用户内容）。以此调 LLM：

```
system = 输出的 systemPrompt
user   = 输出的 userContent
```

LLM 输出经 stdin 校验（1:1 `parseGenerateQuestionResponse`）：

```bash
echo '<LLM原始输出>' | python scripts/aihelp.py parse-ask
```

- `ok:true` → 把 3 个追问逐条展示给用户。
- `ok:false` → **修复一次兜底**（1:1 `checkAndFixJson`）：由模型把输出改写成合法 JSON（去 markdown 围栏/补引号等）后再校验一次；仍失败 → 宣告「追问生成失败」（真实系统对应 `askGenerateFail` + 返还权益），询问用户是否重试。

### Phase 2：用户作答 / 跳过

- 逐条收集 3 个追问的答案；用户可部分或全部跳过。
- 全部跳过/不答也可以进入优化（真实链路允许，information 自动填「无」）。

### Phase 3：优化（promptTwoId，1:1）

```bash
python scripts/aihelp.py render --type <dataFieldCode> --stage opt \
  --fields '<json 同 Phase 1>' \
  --qa '[{"question":"追问1","answer":"答案1"},{"question":"追问2","answer":""}]'
```

`--qa` 传 3 条问答（跳过的答案留 `""`，脚本拼成「无」）；全部跳过则整个 `--qa` 省略。调 LLM 方式同 Phase 1，输出校验：

```bash
echo '<LLM原始输出>' | python scripts/aihelp.py parse-opt
```

判定协议（1:1 `parseOptimizeResponse`）：必须含非空 `resume`；失败 → 修复一次 → 仍失败宣告「优化失败」（对应 `optimizingFail` + 返还权益）。

### Phase 4：交付

- **严格等于接口返回**：只交付 `resume` 字段（优化后内容）。真实 `/record` 不返回 `responsibility`/`suggestion`（只落库）。
- 用户明确要「优化建议/改写思路」时，可把 `suggestion`/`responsibility` 作为**接口外扩展**追加，并标注"以下为扩展信息"。
- 不得附加字数统计、评分、二次润色等接口外动作，除非用户另行要求。
- 仅优化用户粘贴的单个字段、且没有整份简历时，Phase 4 完成后停止并交付该字段文本。
- 已解析整份简历时，Phase 4 是中间结果，不向用户询问文件格式，自动进入 Phase 5。

### Phase 5：生成简历 HTML（接口外扩展，本地渲染，**不调任何接口**）

把（优化后的）整份简历渲染成与线上导出同款样式的 HTML。**整份简历优化的最终交付物固定为 HTML**：只要会话中已经解析整份简历，就在内容优化完成后自动进入 Phase 5。**禁止询问或提供 Word / PDF / HTML 输出格式选择**，也不得把内部 `resumeType` 描述成文件类型。用户若另行需要 PDF，可在 HTML 交付后说明浏览器打印方法，但不得在生成前让用户选择 PDF。

**前置判断（关键分支）**：

- 会话中已有 finalized.json（走过 Phase 0.5）→ 直接进入收集参数。
- 没有需要优化的字段或用户跳过全部优化 → 不创建 overrides，直接用 finalized.json 渲染 HTML。
- 只优化了单字段、没有整份解析 → 告知用户「HTML 是整份简历，需要先有整份简历内容」，引导补走 Phase 0.5（用户提供整份原文）。不要拿单个字段去造一份残缺简历，除非用户明确只要这一段。

**渲染参数（默认直接推断，不发起选择题）**：

| 参数 | 说明 | 兜底 |
|---|---|---|
| 模板风格 | 默认模板固定为 `default`；仅当用户主动指定其他已有风格时采用，不主动询问 | `default` |
| 简历名称 | 从姓名字段生成 HTML 标题/文件名，不主动询问 | 「姓名+的简历」 |
| 优化覆盖 | 本次会话所有优化成功的 `(moduleCode, dataSort, dataFieldCode, resume值)` 累积成 overrides.json；用户口头追加的修改也并进同一文件 | 无优化则省略 `--overrides` |

overrides.json 格式（`dataSort` 省略默认 1，指第几条经历）：

```json
[{"moduleCode": "workExperience", "dataFieldCode": "workExperienceDesc", "dataSort": 1, "value": "优化后内容"}]
```

**必须落盘成 JSON 文件**（放工作区临时目录，如 `.qa/tmp/`）再传给脚本，禁止在命令行内联大段文本（转义风险）。覆盖项必须能定位到 finalized.json 里的既有字段，定位失败脚本直接报错——修正定位，不要绕过。

**执行**：

```bash
python scripts/render_resume_html.py render --finalized finalized.json \
  --overrides overrides.json --template-code <code> --resume-name "<名称>" --out resume.html
```

`--dump-model model.json` 可落盘组装后的模型便于排查；`convert-check` 子命令自检 6 套模板可转换。依赖 `jinja2`（`pip install jinja2`），其余 stdlib。

**交付与迭代**：

- 交付 HTML 文件路径，提示：浏览器打开 → `Ctrl+P` → 另存为 PDF 即得 PDF 版（纸张 A4、勾选「背景图形」效果最佳）。
- 明确告知：全程本地渲染，不调 export 服务、不传数据出本机、不落库。
- 用户看完想改：改 overrides.json 重跑即可（幂等）；想重新优化某段：回 Phase 1。
- 红字「请填写…」是模板设计的未填写占位（与线上预览一致）；空模块是否渲染由解析侧 moduleStatus 决定（见 resume_parse.py finalize 规则），不要手工删模块。
## 关键规则红线（与 Java 行为对齐）

1. **user message 恒为固定字符串** `开始，注意输出格式，注意输出格式`；简历正文只通过 `{{$var}}` 变量进 systemPrompt。不得把简历内容塞进 user message。
2. **空值填「无」**：变量映射、追问答案、information 拼接，所有空白一律填「无」，不得留空或编造。
3. **追问 prompt 没有 `information` 变量**，优化 prompt 才有；两阶段 promptId 不得混用（追问用 promptOneId，优化用 promptTwoId）。
4. **输出协议**：追问 = 非空 `question1/2/3`；优化 = 非空 `resume`。严格 JSON 解析失败只允许「修复一次再校验一次」，不许反复重试或忽略协议直接交付。
5. **prompt 原文运行时获取**：先用 MCP 工具 `resume_prompt_get(prompt_id)` 从服务端取 prompt 原文（promptId 见 `references/field-config.json`，仅作查找键、内部对齐用，不得向用户披露），保存为临时文件后经 `scripts/aihelp.py render --prompt-file` 渲染；不得凭记忆改写、增删 Rules 或 OutputFormat，prompt 原文不随包分发。
6. **模型选择**：各 prompt 的服务端模型选择由服务端维护，本地复跑统一用当前模型。
7. **解析一律走 `scripts/resume_parse.py`**，不得手算清洗/归一化结果，也不得改为引用 resume-diagnosis 的文件（复制件须保持自包含）。
8. 本地复跑**不含**真实链路的敏感词校验、权益扣减/返还、落库与状态机流转；这些是模式 B 的分析对象，不是复跑动作。
9. **HTML 渲染一律走 `scripts/render_resume_html.py`**：不调 export 服务、不传数据出本机；模板 DOM/CSS 以 `references/export/templates/` 原始件为准，脚本只做机械 Freemarker→Jinja2 转换，禁止手改模板样式或凭记忆重写模板 HTML。
10. **overrides 必须落 JSON 文件**传 `--overrides`；覆盖项定位失败（模块/字段/第几条对不上）时修正定位，不得绕过脚本报错。

---

## 资源说明

| 文件 | 内容 | 对应 Java / 配置 |
|---|---|---|
| `references/field-config.json` | **12 种类型权威配置**（promptId 对 + variableMappings，手工对齐服务端设计文档 §2） | 服务端类型配置 fieldConfig |
| `scripts/aihelp.py` | **确定性脚本**：show / render（变量映射+information 拼接）/ parse-ask / parse-opt / selfcheck | 服务端 prompt 装配逻辑 |
| `scripts/resume_parse.py` | **解析脚本（复制自 resume-diagnosis 解析部分）**：emit-template / finalize（清洗+归一化+状态+排序）/ extract-fields | `简历解析逻辑` |
| `scripts/extract_spire.py` / `scripts/extract_doc_text.py` | .doc 原文提取（逐字复制自 resume-diagnosis） | — |
| `scripts/render_resume_html.py` | **简历 HTML 本地渲染**：finalized.json(+overrides)→模型组装（服务端设计文档 §8.2/§8.3）→ Freemarker→Jinja2 机械转换渲染；依赖 jinja2 | `渲染入参装配` / `分页/行数解析逻辑` |
| `references/export/templates/personal_resume_onepage_<code>.html` | 6 套简历模板原始件（2026-08-16 逐字拉自 OSS，public-read） | 服务端模板配置 templateStyleUrl |
| `references/export/resume-fieldtype.config.json` | fieldTypeList（63 项字段类型/绑定/图标/占位）+ onepageConfig 快照 | 服务端字段类型配置 |
| `references/export/resume-style-template.config.json` | 6 套模板 code/名称/URL 快照 | 服务端模板样式配置 |
| `references/resume-module-config.json` | 模块+字段权威配置（逐字复制自 resume-diagnosis，与 `简历模块配置.json` 同源） | `ResumeModuleDataConfig` |
| `references/analysis-resume-rules.md` / `references/resume-schema.md` | 解析规则与配置阅读辅助（逐字复制自 resume-diagnosis） | `analysisResume` |

---

## 局限与免责

- 本 skill 不调真实 bot 平台与 Java 服务，不读写数据库；所有简历数据来自用户输入。
- prompt 原文与配置为 2026-08-16 快照；线上变更后需按模式 B 的同步流程更新，`selfcheck` 负责兜底校验一致性。
- 解析部分为 resume-diagnosis 的逐字复制件（2026-08-16 对拍一致）；服务端解析逻辑变更时两侧同步更新，更新后重新对拍 emit-template / finalize 输出。
- 本地复跑输出仅供内容参考；与线上真实结果的差异主要来自模型版本（尤其实习经历的 wangsu-gpt-4o）与平台 SSE 采样参数。
- HTML 渲染（Phase 5）：lineHeight 固定取 `onepageConfig.defaultLineHeight`(28)，一页纸行高压缩（design.md §8.3 第 7 步）一期不实现；HIDDEN 字段/模块不渲染是按产品行为补的假设（design.md 未覆盖，Java 侧若不同以 Java 为准）；网申简历（resumeType=2）模板结构不同，一期不支持；证件照用模板默认占位图，除非简历里有 idPhoto URL。
- 模板原始件与 fieldtype/模板配置为 2026-08-16 test 环境快照；线上变更后按 §8.4/§8.5 的 dataId 重新拉取覆盖 `references/export/` 对应文件，并跑 `render_resume_html.py convert-check` 自检。
