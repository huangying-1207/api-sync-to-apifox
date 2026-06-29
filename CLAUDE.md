# CLAUDE.md

改**本工具源码**时参考。用户使用说明见 `README.md`；Agent 同步工作流见 `.cursor/skills/api-sync-to-apifox/SKILL.md`；CLI 参数见 `help.txt`。

## 文档分工


| 文件                            | 受众         | 内容                     |
| ----------------------------- | ---------- | ---------------------- |
| `README.md`                   | 人类         | 安装、配置、CI、项目结构          |
| `help.txt`                    | 终端         | CLI 命令与参数（`help` 命令输出） |
| `.cursor/skills/.../SKILL.md` | Agent      | 同步工作流、确认规则、禁止项         |
| `CLAUDE.md`                   | Agent（本仓库） | 架构、模块、开发约定             |


## 开发命令

```bash
npm run build          # Compile TS → dist/
npm run watch          # Watch mode compilation
npm run lint           # ESLint
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier
npm run test           # All tests (Mocha)
npm run check          # build + test
npm run sync-skill     # Copy Cursor Skill to backend projects
```

CLI 子命令：`config init | scan | sync | workflow | branches | mcp | help`

## 架构

入口：`src/index.ts` → `src/cli/program.ts`

```
src/
├── cli/app.ts            # scan / sync / workflow / branches 编排
├── config.ts             # 配置加载与校验
├── core/pipeline.ts      # scan → format 流水线
├── core/scanner/         # ApiScanner、框架解析
├── modules/              # formatter / comparer / syncer
├── mcp/                  # 凭据与交互控制台
└── utils/apifox/         # syncPlan、分支、凭据
```

**数据流：**

```
CLI args → Config → Scanner (Git diff + 框架解析)
         → sync plan (temp/apifox-sync-plan.json)
         → Comparer（有凭据时）→ Formatter → Syncer（分支感知）
```

**关键约束：**

- 增量同步要求 `temp/apifox-sync-plan.json` 已确认（`status: confirmed`，`syncApis` 非空）
- `scan` 会将计划重置为 `pending`
- OpenAPI 字段说明必须为中文（`formatter.ts` 负责生成默认值）
- 配置文件搜索：`.apifoxsync.json` → `.claude/apifoxsync.json` → `config/apifoxsync.json` → 用户主目录
- 凭据：`.apifox-credentials.json`；临时产物：`temp/apifox-sync-plan.*`、`apifox-branches-cache.json`；`formatted-api-doc.json` 仅 `--save-doc` 时生成

**核心模块：**

- `src/cli/app.ts` — 业务编排与同步计划读写
- `src/utils/apifox/syncPlan.ts` — 计划校验、Markdown 生成
- `src/core/scanner/ApiScanner.ts` — Spring Boot / Node.js / Django 扫描
- `src/modules/syncer.ts` — Apifox REST API，指数退避重试（3 次）

类型定义：`src/types/index.ts`