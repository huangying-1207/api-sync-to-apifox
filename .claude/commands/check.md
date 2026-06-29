检查本地代码与 Apifox 上现有 API 的差异，只做对比不同步。

1. 读取 `.apifoxsync.json` 确认 `sync-tool-path`、`apifox-project-id`、`source-path` 有效
2. `node $TOOL scan --scan-type all`（$TOOL 来自 sync-tool-path）
3. 汇总 `temp/apifox-sync-plan.json` 中的差异

仅汇报差异，不执行 sync。
