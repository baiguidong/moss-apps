---
name: gaodun-campus-position-search
display_name: 校招职位搜索
display_name_en: Gaodun Campus Position Search
description: 校园招聘（校招）职位搜索技能。当用户想查询校招岗位（秋招/春招），如"有哪些银行校招""字节校招岗位"，或了解某企业校招机会时使用。支持按校招/企业名称关键词模糊搜索，返回校招名称与工作地点，按更新时间倒序展示。
description_zh: 按校招/企业名称关键词模糊搜索校园招聘（秋招/春招）岗位，返回校招名称与工作地点，按更新时间倒序展示。
description_en: Searches campus recruitment (autumn/spring) positions by company or program keyword, returning program names and work locations sorted by latest update.
category: 15-Education
version: 1.1.0
author: 上海高顿教育科技有限公司
agent_created: true
---

# 校招职位搜索（gaodun-campus-position-search）

基于 `search_campus_position` MCP 工具，从高顿业务系统检索校园招聘岗位（正式秋招/春招，区别于实习岗位），帮助用户了解校招机会。

## 触发场景

- 用户查询校招岗位，如"2026 届银行校招""字节跳动校招"
- 用户想了解某企业/行业的校园招聘机会
- 用户想查看最新上架的校招信息（不传关键词时按更新时间倒序返回全部）

## 核心能力

1. **关键词检索**：按校招或企业名称模糊搜索，如"银行""字节"
2. **最新优先**：不传关键词时返回全部上架校招，按更新时间倒序
3. **信息精简**：每条校招仅含校招名称、工作地点，便于快速浏览

## 调用方式

调用 `search_campus_position` 工具：

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| position_name | string | - | 校招职位名称关键词，模糊搜索，传校招或企业关键词（如"银行""字节"）；不传则返回全部上架校招（按更新时间倒序） |
| page_num | int | - | 页码，从 1 开始，默认 1 |
| page_size | int | - | 每页条数，默认 50 |

## 使用流程

1. 解析用户查询中的企业/行业/校招关键词 → `position_name`
2. 调用工具获取校招列表（含分页信息 total/pageNum）
3. 向用户呈现：按列表展示校招名称 + 工作地点，可分页展示全部结果
4. **用户指定城市时**：拉取校招列表后按返回的 `workCity` 字段本地过滤（如"北京"匹配"北京，上海，深圳"中的"北京"），仅展示含目标城市的条目，并向用户说明已按城市筛选
5. 结果为空时返回提示文本，建议更换关键词后重试

## 注意事项

- `position_name` 为模糊搜索，传企业名或岗位关键词均可
- 该工具仅返回校招名称与工作地点两个核心字段，不要虚构返回中不存在的字段
- 用户未给关键词时，直接不传 `position_name` 获取最新校招列表即可，无需追问
- 返回结果中的 `workCity` 字段可用于本地城市筛选

## 禁止行为（强制遵守）

- ❌ **禁止引申工具不支持的参数/功能**：当用户提出工具不支持的需求时（如某种排序/筛选方式），不得说"试试XX参数/可以用XX"，应直接说明当前支持的选项
- ❌ **建议后续操作时禁止推荐别的工具或技能**：只说明操作本身，不得说"可使用XX工具/建议用XX技能"
