---
name: api-sync-to-apifox
description: >-
  用 LLM 分析 Git 代码变更对后端 API 的影响，生成变更文档供用户确认，确认后才同步到 Apifox。
  适用于 Spring Boot / Node.js / Django。当用户提到接口同步、Apifox、代码变更影响接口时使用。
---

# API 变更影响分析与 Apifox 同步

## 分工原则

| 工具负责 | LLM 负责 |
|---------|---------|
| Git 变更检测 | 从代码识别受影响接口（path / method / 参数） |
| 收集变更源码 + 全量 Controller 源码 | 判定影响面（含 Service/DTO 间接调用链） |
| 获取 Apifox 现有接口快照 | 与 Apifox 快照对比，判断哪些需要更新 |
| 写 plan.json / 生成 plan.md | 填写 `analysis`、`syncApis`、`fieldSupplements` |
| 执行 sync（注解扫描 + 生成 OpenAPI + 推送） | 可选：为 JSONObject 响应补充字段定义 |

> sync 时工具按 `syncApis` 中的 path/method 重新扫注解生成 OpenAPI schema，LLM 无需提供完整 schema，只需填 `syncApis`（加可选 `fieldSupplements`）。

## 路径约定（执行前必读）

1. **工作目录** = 后端项目根目录（Cursor 工作区根），所有命令在此执行。
2. **读取** `.apifoxsync.json`（本地唯一配置文件，含凭据与本机路径，不提交 Git）：

| 配置项 | 说明 |
|--------|------|
| `sync-tool-path` | 本机 `api-sync-to-apifox` 的 `dist/index.js` **绝对路径**（每人不同） |
| `project-name` | Apifox 项目名 |
| `apifox-project-id` | Apifox 项目 ID |
| `apifox-api-key` | Apifox API 密钥 |
| `source-path` | 源码目录（相对项目根，如 `./src/main/java`） |
| `framework` | `springboot` / `nodejs` / `django` |

3. 若缺少 `sync-tool-path`，提示用户在项目根执行 `npm run sync-skill`（在工具仓库）或手动写入配置。
4. **命令格式**：`node <sync-tool-path> <子命令>` — 工具会自动合并 `.apifoxsync.json` 中的其他项。

> 下文用 `$TOOL` 表示 `sync-tool-path`，`$PROJECT` 表示 `project-name`。

## 工作流

```
- [ ] Step 0: 读取 .apifoxsync.json，确认 sync-tool-path 有效
- [ ] Step 1: workflow / scan → 收集材料（变更源码 + Controller 源码 + Apifox 快照）
- [ ] Step 2: LLM 读 plan.json → 识别受影响接口 → 填写 analysis / syncApis
- [ ] Step 3: 展示 plan.md → 询问分支 → 等用户明确确认
- [ ] Step 4（可选）: LLM 为 JSONObject 响应补充字段 → 填 fieldSupplements → sync
```

## Step 1: workflow（推荐）或 scan

```bash
node $TOOL workflow --project-name $PROJECT
```

等价于 `scan` + `branches --json`（分支列表输出到 stdout）。

或分步：

```bash
node $TOOL scan --scan-type changed
node $TOOL branches --json
```

> scan 会强制将计划重置为 `pending`，作废旧确认。

scan 产出 `temp/apifox-sync-plan.json`，包含：
- `changedFiles`：git 变更的文件路径列表
- `gitDiff`：完整 git diff 文本
- `changedSourceFiles`：变更的 Java 源文件完整内容（含 Controller / Service / DTO 等）
- `controllerSourceFiles`：全量 Controller 源文件内容（供 LLM 识别接口定义与调用关系）
- `apifoxSnapshot`：Apifox 现有接口的 OpenAPI JSON 快照

## Step 2: LLM 分析

读取 `temp/apifox-sync-plan.json`，按以下顺序逐步分析：

### 2-A 候选接口收集

1. **直接变更**：读 `changedSourceFiles` 中的 Controller 文件，列出路径 / 方法有变化的接口
2. **间接影响**：读 `changedSourceFiles` 中的 Service / DTO 文件，对照 `controllerSourceFiles` 找出引用了这些类的 Controller 接口

### 2-B 与 Apifox 快照逐一比对（核心步骤）

对 2-A 收集的每个候选接口，在 `apifoxSnapshot.paths` 中找到对应的路径与方法，比较：

| 比对维度 | 代码侧 | Apifox 侧 |
|---------|--------|-----------|
| 请求参数 | `controllerSourceFiles` 中的 `@RequestParam` / `@PathVariable` | `parameters` |
| 请求体字段 | `@RequestBody` 对应 DTO 的字段列表 | `requestBody.content.*.schema` |
| 响应体字段 | 返回类型对应的字段列表 | `responses.200.content.*.schema` |

**判定规则：**

- **有差异** → 纳入 `affectedApis`，`changeSummary` 写明具体差异（字段新增/删除/类型变化）
- **完全一致** → 纳入 `excludedApis`，`reason` 写 `"与 Apifox 快照已一致，无需同步"`
- **Apifox 无此接口** → 纳入 `affectedApis`，`impactType` 标 `"new_api"`

> **`affectedApis` 只放代码与 Apifox 真正对不上的接口。** 代码虽然变了但 Apifox 已经是最新的，一律放 `excludedApis`。

### 2-C 填写 plan

```json
{
  "analysis": {
    "summary": "分析摘要",
    "affectedApis": [
      {
        "method": "POST",
        "path": "/api/...",
        "impactType": "response",
        "changeSummary": "新增字段 fieldA（string），Apifox 快照中缺失"
      }
    ],
    "excludedApis": [
      { "method": "GET", "path": "/api/...", "reason": "与 Apifox 快照已一致，无需同步" }
    ]
  },
  "syncApis": [{ "method": "POST", "path": "/api/..." }]
}
```

> 所有受影响接口（直接变更 + Service/DTO 间接影响）统一写入 `analysis.affectedApis`，不另设字段。

填完后执行：

```bash
node $TOOL refresh-plan
```

重新生成 `plan.md`（`analysis` → `## 确认受影响接口` 表）。

## Step 3: 用户确认

1. 向用户展示分支**名称**列表（不要展示 ID），询问同步到哪个分支，默认主分支。
2. 展示 `temp/apifox-sync-plan.md`，**必须等用户明确回复「确认同步到 <分支名>」**。

## Step 4: JSONObject 字段兜底 + sync

若接口响应为 `JSONObject` / `Map` 且字段不明确（工具无法从注解推断），LLM 读 Controller / Service 代码中的 `.put("field", ...)` 调用，填写 `fieldSupplements`：

```json
{
  "fieldSupplements": [{
    "method": "GET",
    "path": "/api/students/query/ext/{id}",
    "mapFields": {
      "studentId": { "type": "integer" },
      "source": { "type": "string" }
    }
  }]
}
```

用户确认后更新计划：

```json
{
  "status": "confirmed",
  "userConfirmed": true,
  "confirmedAt": "<ISO时间>",
  "targetBranch": { "id": 1234568, "name": "dev", "isMain": false },
  "syncApis": [{ "method": "POST", "path": "/api/..." }]
}
```

执行：

```bash
node $TOOL sync --sync-mode incremental
```

未确认时 sync 拒绝执行。调试时可加 `--save-doc` 将 OpenAPI 文档写入 `temp/formatted-api-doc.json`。

## 禁止

- 不要在用户确认前执行 sync
- 不要在 Skill 或 Git 中写死本机绝对路径

## 附录：分析报告格式

> Step 2 分析后更新 `temp/apifox-sync-plan.json`，执行 `refresh-plan` 生成 `temp/apifox-sync-plan.md`

### 分析概要

- **分析时间**: {timestamp}
- **变更文件数**: {changedFileCount}
- **确认受影响接口数**: {confirmedCount}
- **排除接口数**: {excludedCount}

### 变更源分析

#### {ChangeSourceClassName}

**变更类型**: 字段新增 / 字段删除 / 字段修改 / 方法变更

**变更详情**:
```
{git diff 摘要或字段列表}
```

**业务含义**: {简要说明变更的业务影响}

##### 确认受影响接口

> 只列代码与 Apifox 快照**真正对不上**的接口。

| 方法 | 路径 | 影响类型 | 变更说明 |
|------|------|----------|---------|
| GET | /api/xxx | response | 新增字段 fieldA（string），Apifox 快照缺失 |
| POST | /api/zzz | request_body | DTO 新增必填字段 fieldC，Apifox 快照无此字段 |

##### 排除的接口

| 方法 | 路径 | 排除原因 |
|------|------|----------|
| GET | /api/yyy | 与 Apifox 快照已一致，无需同步 |
| PUT | /api/aaa | 仅注释变更，接口契约未变 |

### 同步建议

**需要同步的接口** — 写入 `syncApis`

**无需同步** — 纯内部 Service/Repository 变更，或确认不影响 API 契约

## 附录：速查

### 数据流

```
Git diff
  → changedFiles / changedSourceFiles / controllerSourceFiles / apifoxSnapshot
  → plan.json（pending）

LLM
  → 读 changedSourceFiles（识别接口变更、判定间接影响）
  → 读 controllerSourceFiles（确认接口定义）
  → 读 apifoxSnapshot（对比现有 schema）
  → 填 analysis / syncApis / fieldSupplements（可选）

refresh-plan → plan.md
用户确认 → sync → Apifox
```

### 同步计划结构

```json
{
  "version": 1,
  "status": "pending",
  "changedFiles": [],
  "gitDiff": "...",
  "changedSourceFiles": [{ "file": "src/.../UserController.java", "content": "..." }],
  "controllerSourceFiles": [{ "file": "src/.../OrderController.java", "content": "..." }],
  "apifoxSnapshot": { "openapi": "3.0.0", "paths": {} },
  "fieldSupplements": [],
  "analysis": {
    "summary": "",
    "affectedApis": [],
    "excludedApis": [],
    "changeSources": [{
      "sourceClass": "NoticeServiceImpl",
      "changeType": "字段新增",
      "affectedApis": [{ "method": "GET", "path": "/api/notices", "impactType": "response" }]
    }]
  },
  "syncApis": [],
  "userConfirmed": false
}
```

### 常用命令

```bash
node $TOOL workflow --project-name $PROJECT
node $TOOL branches --json
node $TOOL scan --scan-type changed
node $TOOL refresh-plan
node $TOOL sync --sync-mode incremental
node $TOOL sync --sync-mode full
node $TOOL sync --save-doc
```

### 首次接入 / 更新 Skill

在后端项目根目录配置 `.apifoxsync.json`（`sync-skill` 会自动写入 `sync-tool-path`）：

```json
{
  "sync-tool-path": "<本机 api-sync-to-apifox/dist/index.js 绝对路径>",
  "project-name": "<Apifox 项目名>",
  "source-type": "code",
  "source-path": "./src/main/java",
  "framework": "springboot"
}
```

从工具仓库同步 Skill 到本项目（在工具仓库执行，路径换成你的本机目录）：

```bash
npm run build
node scripts/sync-skill.js --path <后端项目根目录>
```
