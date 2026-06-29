---
name: api-sync-to-apifox
description: >-
  用 LLM 分析 Git 代码变更对后端 API 的影响，生成变更文档供用户确认，确认后才同步到 Apifox。
  适用于 Spring Boot / Node.js / Django。当用户提到接口同步、Apifox、代码变更影响接口时使用。
---

# API 变更影响分析与 Apifox 同步

**影响分析完全由 LLM 负责**，工具只做：Git 变更检测、Controller 扫描、变更文档生成、Apifox 同步。

## 工作流

```
- [ ] Step 1: scan → 生成变更文档草稿
- [ ] Step 2: LLM 分析 git diff → 填写 syncApis
- [ ] Step 3: 展示文档 → 询问 Apifox 目标分支 → 等用户明确确认
- [ ] Step 4: 更新计划为 confirmed（含 targetBranch）→ sync
```

## Step 1: workflow（推荐）或 scan

```bash
node dist/index.js workflow --project-name <项目名>
```

等价于 `scan` + `branches --json`（分支列表输出到 stdout）。

或分步：

```bash
node dist/index.js scan --source-type code --source-path <路径> --framework springboot --scan-type changed
node dist/index.js branches --json
```

> scan 会强制将计划重置为 `pending`，作废旧确认。

`scanCandidates` 仅含**直接修改的 Controller** 中的接口；DTO/Service/Entity 等变更需 LLM 读 `gitDiff` 分析间接影响。

## Step 2: LLM 分析

读取 `temp/apifox-sync-plan.json`，分析 `gitDiff` 和变更文件，更新：

```json
{
  "analysis": {
    "summary": "分析摘要",
    "affectedApis": [{ "method": "POST", "path": "/api/...", "impactType": "response", "changeSummary": "..." }],
    "excludedApis": [{ "method": "GET", "path": "/api/...", "reason": "仅注释变更，不影响接口" }]
  },
  "syncApis": [{ "method": "POST", "path": "/api/..." }]
}
```

分析报告格式见下文「附录：分析报告格式」。

## Step 3: 用户确认

1. **查询分支**（展示给用户前执行）：

```bash
node dist/index.js branches --json
```

2. 向用户展示分支**名称**列表（不要展示 ID），询问同步到哪个分支，默认主分支。
3. 展示 `temp/apifox-sync-plan.md`，**必须等用户明确回复「确认同步到 <分支名>」**。

## Step 4: sync

用户确认后更新计划（`targetBranch` 的 `name` 用用户选择的分支名，`id` 从 `branches --json` 结果中匹配）：

```json
{
  "status": "confirmed",
  "userConfirmed": true,
  "confirmedAt": "<ISO时间>",
  "targetBranch": { "id": 1234568, "name": "dev", "isMain": false },
  "syncApis": [{ "method": "POST", "path": "/api/..." }]
}
```

主分支示例（项目主分支可能叫 `master` 而非 `main`）：

```json
"targetBranch": { "id": 1234567, "name": "master", "isMain": true }
```

执行：

```bash
node dist/index.js sync --sync-mode incremental
```

未确认时 sync 拒绝执行。调试时可加 `--save-doc` 将 OpenAPI 文档写入 `temp/formatted-api-doc.json`。

## 禁止

- 不要在用户确认前执行 sync
- 不要依赖静态依赖图分析影响（已移除）

## 附录：分析报告格式

> Step 2 分析后更新 `temp/apifox-sync-plan.json` 与 `temp/apifox-sync-plan.md`

### 分析概要

- **分析时间**: {timestamp}
- **变更文件数**: {changedFileCount}
- **scan 候选接口数**: {scanCandidateCount}
- **LLM 确认受影响接口数**: {confirmedCount}
- **排除接口数**: {excludedCount}
- **补充遗漏数**: {addedCount}

### 变更源分析

#### {ChangeSourceClassName}

**变更类型**: 字段新增 / 字段删除 / 字段修改 / 方法变更

**变更详情**:
```
{git diff 摘要或字段列表}
```

**业务含义**: {简要说明变更的业务影响}

##### 确认受影响接口

| 方法 | 路径 | 影响类型 | 影响字段 | 分析依据 |
|------|------|----------|----------|----------|
| GET | /api/xxx | response | fieldA, fieldB | DTO 含同名字段且通过 copyProperties 进入响应 |

##### 排除的接口

| 方法 | 路径 | 排除原因 |
|------|------|----------|
| GET | /api/yyy | 仅日志注释变更，不影响接口契约 |

##### 补充的遗漏

| 方法 | 路径 | 影响类型 | 分析依据 |
|------|------|----------|----------|
| POST | /api/zzz | request_body | 直接修改了 RequestBody DTO 字段 |

### 同步建议

**需要同步的接口** — 写入 `syncApis`

**无需同步** — 纯内部 Service/Repository 变更，或确认不影响 API 契约

## 附录：速查

### 数据流

```
Git diff → changedFiles → scanCandidates → apifox-sync-plan.json
         → LLM 填写 syncApis → 用户确认 → sync → Apifox
```

### 同步计划完整结构

```json
{
  "version": 1,
  "status": "pending",
  "changedFiles": [],
  "gitDiff": "...",
  "scanCandidates": [{ "method": "GET", "path": "/api/foo", "controllerClass": "FooController" }],
  "analysis": { "summary": "", "affectedApis": [], "excludedApis": [] },
  "syncApis": [],
  "userConfirmed": false
}
```

### 常用命令

```bash
node dist/index.js workflow --project-name <项目名>   # scan + branches 一键
node dist/index.js branches --json                    # 查询分支（确认前）
node dist/index.js scan --scan-type changed
node dist/index.js sync --sync-mode incremental       # 需已确认的计划
node dist/index.js sync --sync-mode full              # 全量，无需计划
node dist/index.js sync --save-doc                    # 调试：保存 OpenAPI 到 temp/
```

### 其他文档

- 人类用户手册：`README.md`
- CLI 参数详情：`help.txt`（`node dist/index.js help`）
- 改工具源码：`CLAUDE.md`
