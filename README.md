# api-sync-to-apifox

CLI 工具，扫描后端 API（Spring Boot、Node.js、Django）并同步到 Apifox。支持增量/全量同步、Git 变更检测、Swagger/OpenAPI 导入，以及 MCP 交互式项目管理。

## 安装

```bash
npm install
npm run build
```

## 快速开始

### 1. 连接 Apifox 项目

```bash
node dist/index.js mcp connect <项目名> <项目ID> <API密钥>
```

### 2. 初始化配置

```bash
node dist/index.js config init --source-path <项目源码路径> --framework springboot
```

自动从 MCP 连接信息加载 `apifox-project-id` 和 `apifox-api-key`，生成 `.apifoxsync.json`。

### 3. 扫描接口变更

```bash
node dist/index.js scan --source-type code --source-path <路径> --framework springboot --scan-type changed
```

### 4. 同步到 Apifox

```bash
node dist/index.js sync --project-name <项目名> --source-type code --source-path <路径> --framework springboot --sync-mode incremental
```

## 命令

| 命令 | 说明 |
|------|------|
| `config init [参数]` | 初始化配置文件，支持 `--source-path`、`--framework` |
| `scan` | 扫描接口变更（不执行同步） |
| `sync` | 扫描并同步接口到 Apifox |
| `mcp` | 启动 MCP 交互式控制台 |

详细参数说明请执行 `--help` 查看。

## 配置

配置文件 `.apifoxsync.json`（已加入 `.gitignore`）：

| 配置项 | 必填 | 说明 | 可选值 | 默认值 |
|--------|------|------|--------|--------|
| source-type | 是 | 数据源类型 | `swagger` \| `code` | `code` |
| source-path | 是 | 源路径（代码目录或 Swagger URL） | - | `./src` |
| framework | 条件必填 | 后端框架（source-type 为 code 时） | `springboot` \| `nodejs` \| `django` | `springboot` |
| sync-mode | 否 | 同步模式 | `incremental` \| `full` | `incremental` |
| scan-type | 否 | 扫描类型 | `all` \| `changed` | `changed` |
| trigger-mode | 否 | 触发模式 | `auto` \| `manual` | `auto` |

MCP 连接信息保存在 `.apifox-credentials.json`（同样在 `.gitignore` 中）。

## 同步模式

- **增量同步（incremental）**：基于 Git diff 检测变更文件，只同步变更的接口，输出变更统计（新增、更新、删除）
- **全量更新（full）**：同步所有接口，适用于项目初始化或重构后

## 支持的框架

### Spring Boot
- 识别 `@RestController` 注解的类
- 识别 `@GetMapping`、`@PostMapping`、`@PutMapping`、`@DeleteMapping`
- 提取 `@PathVariable`、`@RequestParam`、`@RequestBody` 参数
- 解析 DTO 类字段作为响应字段
- 支持 `List<T>`、`JSONObject` 等返回类型

### Node.js
- 识别 `app.get()`、`router.post()` 等路由方法
- 支持 Express 风格路由

### Django
- 识别 `urls.py` 中的 `path()` 路由定义

## MCP 控制台

```bash
node dist/index.js mcp
```

| 命令 | 说明 |
|------|------|
| `connect <名称> <项目ID> <API密钥>` | 连接 Apifox 项目 |
| `disconnect <名称>` | 断开连接 |
| `status` | 显示连接状态 |
| `apis <名称>` | 获取项目接口列表 |
| `info <名称>` | 显示项目详情 |
| `help` | 显示帮助 |

## CI/CD 集成

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
    npx api-sync-to-apifox sync
```

## Cursor Skill

本项目内置 Cursor Agent Skill，支持「代码变更 → LLM 影响分析 → Apifox 同步」完整工作流。

**Skill 路径**: `.cursor/skills/api-sync-to-apifox/SKILL.md`

### 工作流

1. **scan** — 检测 Git 变更，生成 `temp/apifox-sync-plan.json`
2. **LLM 分析** — Agent 读 git diff，填写 `syncApis`
3. **用户确认** — 审阅 `apifox-sync-plan.md`
4. **sync** — 仅同步已确认计划中的接口

在 Cursor 中提及「接口同步」「Apifox」「代码变更影响接口」时，Agent 会自动加载该 Skill。

### 同步 Skill 到后端项目

工具更新后，将 Cursor Skill 同步到任意后端项目：

```bash
# 方式一：命令行指定路径（推荐，无需改配置）
npm run build
npm run sync-skill -- --path D:/IDEA/your-backend-project
npm run sync-skill -- --path D:/IDEA/proj-a --path D:/IDEA/proj-b

# 方式二：写入本地配置文件后批量同步
cp scripts/skill-targets.example.json scripts/skill-targets.json
# 编辑 skill-targets.json 填写 targets
npm run sync-skill
npm run sync-skill -- --target my-backend   # 只同步配置中某一个
npm run sync-skill -- --list                # 查看配置列表
```

`skill-targets.json` 为本地配置（已 gitignore），每人路径不同互不影响。  
若目标项目已有 `.apifoxsync.json`，会自动读取 `source-path`、`framework`、`project-name`。

## 开发

```bash
npm run build        # 编译 TS → dist/
npm run watch        # 监听模式编译
npm run lint         # ESLint 检查
npm run lint:fix     # ESLint 自动修复
npm run format       # Prettier 格式化
npm run test         # 运行测试
```

## 获取 Apifox 项目信息

- **项目 ID**：Apifox → 项目设置 → 项目 ID
- **API 密钥**：Apifox → 个人设置 → API 密钥
