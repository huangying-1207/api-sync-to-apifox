# api-sync-to-apifox

CLI 工具：扫描后端 API（Spring Boot、Node.js、Django），生成变更文档，经确认后同步到 Apifox。支持增量/全量同步、Git 变更检测、Swagger/OpenAPI 导入，以及 Cursor Agent 辅助的「代码变更 → 影响分析 → 确认同步」工作流。

## 它能做什么

```
写代码 → 扫描变更 → 分析影响 → 你确认 → 同步到 Apifox
```

- **工具负责**：Git 变更检测、Controller 扫描、OpenAPI 文档生成、Apifox 推送
- **LLM 负责**（Cursor Skill 场景）：读 `git diff`，判断 DTO/Service 等间接变更影响了哪些接口
- **你负责**：审阅变更文档、选择 Apifox 目标分支、明确确认后才同步

## 安装

```bash
npm install
npm run build
```

## 快速开始

### 1. 连接 Apifox 项目

在 Apifox 获取**项目 ID**（项目设置）和 **API 密钥**（个人设置），然后：

```bash
node dist/index.js mcp connect <项目名> <项目ID> <API密钥>
```

连接信息保存在 `.apifox-credentials.json`（已 gitignore）。

### 2. 初始化配置

```bash
node dist/index.js config init --source-path <项目源码路径> --framework springboot
```

自动从 MCP 凭据加载 `apifox-project-id`、`apifox-api-key`，生成 `.apifoxsync.json`（已 gitignore）。

### 3. 扫描接口变更

```bash
node dist/index.js scan --source-type code --source-path <路径> --framework springboot --scan-type changed
```

产出 `temp/apifox-sync-plan.json` 与 `temp/apifox-sync-plan.md`（状态为 `pending`，待确认）。

### 4. 同步到 Apifox

**增量同步**必须先确认同步计划（见下文「同步计划与确认」）。确认后执行：

```bash
node dist/index.js sync --sync-mode incremental
```

**全量同步**（项目初始化或重构后）无需计划：

```bash
node dist/index.js sync --sync-mode full
```

## 推荐使用方式

### 方式 A：Cursor Agent 工作流（日常开发推荐）

在 Cursor 中提及「接口同步」「Apifox」「代码变更影响接口」，Agent 会加载 Skill（`.cursor/skills/api-sync-to-apifox/SKILL.md`，含工作流、分析报告格式与附录速查）。

| 步骤 | 动作 | 产出 |
|------|------|------|
| 1. workflow | `node dist/index.js workflow --project-name <项目名>` | 变更计划草稿 + 分支列表 |
| 2. LLM 分析 | 读 `gitDiff`，填写 `syncApis` / `excludedApis` | 更新 `apifox-sync-plan.json` |
| 3. 用户确认 | 审阅 `apifox-sync-plan.md`，选择目标分支 | 回复「确认同步到 \<分支名\>」 |
| 4. sync | `node dist/index.js sync --sync-mode incremental` | 仅推送已确认接口 |

> **重要**：未明确确认前，`sync` 会拒绝执行增量同步。

### 方式 B：命令行 / CI/CD

适合流水线全量同步，或熟练用户手动操作。CI 示例见下文。

## 命令

| 命令 | 说明 |
|------|------|
| `config init [参数]` | 初始化/合并 `.apifoxsync.json` |
| `scan` | 扫描接口变更（不同步） |
| `sync` | 同步接口到 Apifox |
| `workflow` | 一键：`scan` + `branches --json` |
| `branches` | 列出 Apifox 迭代分支（`--json` 机器可读） |
| `mcp` | MCP 交互式控制台 |
| `help` | 显示帮助（详见 `help.txt`） |

通用选项：`--quiet`、`--json`、`--project-name`（使用 MCP 已连接项目）。

详细参数：`node dist/index.js <command> --help` 或 `help`。

## 同步计划与确认

增量同步依赖 `temp/apifox-sync-plan.json`：

```json
{
  "version": 1,
  "status": "pending",
  "changedFiles": [],
  "gitDiff": "...",
  "scanCandidates": [{ "method": "GET", "path": "/api/foo", "controllerClass": "FooController" }],
  "analysis": {
    "summary": "分析摘要",
    "affectedApis": [],
    "excludedApis": []
  },
  "syncApis": [],
  "userConfirmed": false
}
```

- `scanCandidates`：直接修改的 Controller 中的接口（工具自动扫描）
- DTO/Service/Entity 等间接影响：需 LLM 读 `gitDiff` 分析后写入 `syncApis`
- 每次 `scan` 会将计划重置为 `pending`，作废旧确认

用户确认后更新为：

```json
{
  "status": "confirmed",
  "userConfirmed": true,
  "confirmedAt": "2026-06-29T10:00:00.000Z",
  "targetBranch": { "id": 1234568, "name": "dev", "isMain": false },
  "syncApis": [{ "method": "POST", "path": "/api/..." }]
}
```

查询可用分支：

```bash
node dist/index.js branches --json
```

向用户展示分支**名称**（不展示 ID），确认时只需分支名（如 `master`、`dev`）。

## 同步模式

| 模式 | 说明 | 是否需要确认计划 |
|------|------|------------------|
| `incremental`（默认） | 仅同步计划中 `syncApis` 列出的接口 | 是 |
| `full` | 同步所有扫描到的接口 | 否 |

也可指定单个或多个接口同步：

```bash
node dist/index.js sync --api-method GET --api-path /api/users
node dist/index.js sync --apis "GET:/api/users,POST:/api/users"
```

## 配置

配置文件搜索顺序：`.apifoxsync.json` → `.claude/apifoxsync.json` → `config/apifoxsync.json` → 用户主目录。

| 配置项 | 必填 | 说明 | 可选值 | 默认值 |
|--------|------|------|--------|--------|
| source-type | 是 | 数据源类型 | `swagger` \| `code` | `code` |
| source-path | 是 | 代码目录、Swagger URL 或本地 OpenAPI 文件 | - | `./src` |
| framework | 条件必填 | 后端框架（source-type 为 code 时） | `springboot` \| `nodejs` \| `django` | `springboot` |
| apifox-project-id | 条件必填 | Apifox 项目 ID（无 project-name 时） | - | - |
| apifox-api-key | 条件必填 | Apifox API 密钥（无 project-name 时） | - | - |
| project-name | 否 | MCP 已连接项目名（可替代 ID/密钥） | - | - |
| sync-mode | 否 | 同步模式 | `incremental` \| `full` | `incremental` |
| scan-type | 否 | 扫描类型 | `all` \| `changed` | `changed` |
| trigger-mode | 否 | 触发模式 | `auto` \| `manual` | `auto` |
| apifox-branch-name | 否 | 指定 Apifox 分支名称 | - | 主分支 |

## 支持的框架

### Spring Boot

- `@RestController`、`@GetMapping` / `@PostMapping` / `@PutMapping` / `@DeleteMapping`
- `@PathVariable`、`@RequestParam`、`@RequestBody`
- DTO 字段解析、`List<T>`、`JSONObject` 等返回类型

### Node.js

- `app.get()`、`router.post()` 等 Express 风格路由

### Django

- `urls.py` 中的 `path()` 路由定义

## MCP 控制台

```bash
node dist/index.js mcp
```

| 命令 | 说明 |
|------|------|
| `connect <名称> <项目ID> <API密钥>` | 连接 Apifox 项目 |
| `disconnect <名称>` | 断开连接 |
| `status` | 显示连接状态 |
| `scan [项目名] [--参数...]` | 扫描接口变更 |
| `sync [项目名] [--参数...]` | 同步到 Apifox |
| `apis <名称>` | 获取项目接口列表 |
| `info <名称>` | 显示项目详情 |
| `help` | 显示帮助 |

## 临时文件

扫描与工作流产物写入 `temp/`（已 gitignore）：

| 文件 | 说明 |
|------|------|
| `apifox-sync-plan.json` | 同步计划（机器可读） |
| `apifox-sync-plan.md` | 变更文档（人工审阅，由 JSON 自动生成） |
| `apifox-branches-cache.json` | 分支列表缓存（内部使用） |
| `formatted-api-doc.json` | 仅 `--save-doc` 时生成，调试用 OpenAPI 文档 |

## Cursor Skill 同步到后端项目

工具更新后，将 Skill 复制到任意后端项目：

```bash
npm run build
npm run sync-skill -- --path D:/IDEA/your-backend-project
npm run sync-skill -- --path D:/IDEA/proj-a --path D:/IDEA/proj-b

# 或批量配置
cp scripts/skill-targets.example.json scripts/skill-targets.json
npm run sync-skill
npm run sync-skill -- --target my-backend
npm run sync-skill -- --list
```

`skill-targets.json` 为本地配置（已 gitignore）。若目标项目已有 `.apifoxsync.json`，会自动读取 `source-path`、`framework`、`project-name`。

## CI/CD 集成

全量同步示例（无需同步计划）：

```yaml
- name: Sync to Apifox
  run: |
    cat > .apifoxsync.json << EOF
    {
      "apifox-project-id": "${{ secrets.APIFOX_PROJECT_ID }}",
      "apifox-api-key": "${{ secrets.APIFOX_API_KEY }}",
      "source-type": "code",
      "source-path": "./src/main/java",
      "framework": "springboot"
    }
    EOF
    npx api-sync-to-apifox sync --sync-mode full
```

增量同步需先由 LLM/人工生成并确认 `apifox-sync-plan.json`，再执行 `sync --sync-mode incremental`。

## 项目结构

```
src/
├── index.ts              # CLI 入口
├── config.ts             # 配置管理
├── cli/                  # program、app、configInit、help
├── clients/              # Apifox HTTP 客户端
├── core/                 # pipeline、scanner
├── modules/              # comparer、formatter、syncer
├── mcp/                  # MCP 控制台与凭据管理
├── types/                # 类型定义
└── utils/                # git、logger、openapi、apifox 工具
```

## 开发

```bash
npm run build        # 编译 TS → dist/
npm run check        # 构建 + 测试
npm run watch        # 监听模式编译
npm run lint         # ESLint 检查
npm run lint:fix     # ESLint 自动修复
npm run format       # Prettier 格式化
npm run test         # 运行测试（pretest 自动 build）
```

## 获取 Apifox 项目信息

- **项目 ID**：Apifox → 项目设置 → 项目 ID
- **API 密钥**：Apifox → 个人设置 → API 密钥

## 文档说明

| 文件 | 给谁看 | 写什么 |
|------|--------|--------|
| `README.md` | 人类 | 安装、配置、使用场景、CI |
| `help.txt` | 终端 | CLI 命令与参数（`node dist/index.js help`） |
| `.cursor/skills/.../SKILL.md` | Cursor Agent | 同步工作流、分析报告格式、附录速查 |
| `CLAUDE.md` | 改工具源码的 Agent | 架构、模块、开发约定 |
