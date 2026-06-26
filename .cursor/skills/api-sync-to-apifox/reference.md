# API Sync to Apifox — 参考文档

## 架构

```
Git diff → changedFiles
         → scan 直接变更的 Controller（scanCandidates）
         → apifox-sync-plan.json（待 LLM 分析）
         → LLM 填写 syncApis
         → 用户确认
         → sync 推送到 Apifox
```

## 同步计划结构 (apifox-sync-plan.json)

```json
{
  "version": 1,
  "status": "pending",
  "changedFiles": [],
  "gitDiff": "...",
  "scanCandidates": [{ "method": "GET", "path": "/api/foo", "controllerClass": "FooController" }],
  "analysis": {
    "summary": "",
    "affectedApis": [],
    "excludedApis": []
  },
  "syncApis": [],
  "targetBranch": { "name": "main", "isMain": true },
  "userConfirmed": false
}
```

## 常用命令

```bash
node dist/index.js workflow --project-name <项目名>   # scan + branches 一键
node dist/index.js branches --json                # 查询分支（确认前）
node dist/index.js scan --scan-type changed
node dist/index.js sync --sync-mode incremental   # 需已确认的计划
node dist/index.js sync --apifox-branch-name dev  # 按分支名同步
```

## CI/CD

增量同步需先由 LLM/人工生成并确认 `apifox-sync-plan.json`；CI 全量同步可用 `--sync-mode full`。
