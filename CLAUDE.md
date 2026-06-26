# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CLI tool that scans backend APIs (Spring Boot, Node.js, Django) and syncs them to Apifox. Supports incremental/full sync, Git-based change detection, and Swagger/OpenAPI import. Also provides an MCP client for interactive Apifox project management.

## Commands

```bash
npm run build          # Compile TS → dist/
npm run watch          # Watch mode compilation
npm run lint           # ESLint
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier
npm run test           # All tests (Mocha)
npm run test:dev       # Tests in watch mode
npm run test:helper    # Helper tests only
npm run test:error     # Error handler tests only
npm run test:scanner   # Scanner tests only
npm start              # Run the CLI
```

## Architecture

Entry point: `src/index.ts` — thin wrapper, delegates to `src/cli/program.ts`.

```
src/
├── index.ts              # CLI 入口（薄层）
├── config.ts             # 配置管理
├── cli/                  # 命令行层
│   ├── program.ts        # commander 子命令注册
│   ├── app.ts            # scan / sync / workflow 编排
│   ├── configInit.ts     # config init
│   └── help.ts
├── clients/
│   └── apifoxClient.ts   # Apifox HTTP 客户端
├── core/
│   ├── pipeline.ts       # scan → format 流水线
│   └── scanner/
│       ├── ApiScanner.ts       # 扫描编排
│       ├── frameworks.ts       # 框架配置
│       └── springbootParser.ts # Spring Boot 解析
├── modules/              # formatter / comparer / syncer
├── mcp/                  # MCP 连接管理
├── types/
└── utils/
    ├── cliArgs.ts        # 参数解析与校验
    ├── apifox/           # 分支、同步计划、凭据
    └── openapi/          # OpenAPI 遍历、接口 diff
```

**Data flow:**
```
CLI args → Config (src/config.ts)
         → Scanner (src/core/scanner/ApiScanner.ts) — detects APIs from code or Swagger
         → Comparer (src/modules/comparer.ts) — diffs against existing Apifox APIs
         → Formatter (src/modules/formatter.ts) — generates OpenAPI 3.x docs with Chinese descriptions
         → Syncer (src/modules/syncer.ts) — pushes to Apifox API
```

**MCP integration** is separate: `src/mcp/apifox.ts` (client) + `src/mcp/mcp-server.ts` (interactive console).

**Key modules:**
- `src/config.ts` — finds/validates config from `.apifoxsync.json`, CLI args, or defaults
- `src/core/scanner/ApiScanner.ts` — framework-specific scanners (Spring Boot, Node.js, Django); uses Git diff for incremental scan
- `src/modules/formatter.ts` — converts scanned APIs → OpenAPI 3.x; auto-generates Chinese field descriptions; handles Java→OpenAPI type mapping
- `src/modules/syncer.ts` — Apifox REST API integration; retry with exponential backoff (3 attempts)
- `src/utils/errorHandler.ts` — typed error handling; logs to `logs/apifox-sync-{date}.log`

**Types:** `src/types/index.ts` — `ApiInfo`, `ApiParameter`, `ApiComparisonResult`, `ApiDocument`, `Config`, `FrameworkConfig`

## Key Conventions

- Config file locations searched in order: `.apifoxsync.json`, `.claude/apifoxsync.json`, `config/apifoxsync.json`, user home directory
- All field descriptions in OpenAPI output must be in Chinese; the formatter generates defaults if missing
- Scanner extracts DTO schemas from non-Controller Java files for Spring Boot projects
- Incremental scan requires a Git repository (uses `git diff`)
- MCP credentials persisted in `.apifox-credentials.json`
- Temp formatted docs written to `temp/` during sync
