将已确认的接口变更同步到 Apifox。

步骤：
1. 执行 `npm run build` 确保编译通过
2. 检查 `temp/apifox-sync-plan.json` 是否存在且 `userConfirmed === true`、`status === confirmed`
3. 若计划未确认：先完成 scan + LLM 分析，展示 `apifox-sync-plan.md`，等用户明确确认后再继续
4. 用户确认后，更新计划中的 `userConfirmed`、`status`、`confirmedAt`
5. 执行 `node dist/index.js sync --source-type <配置值> --source-path <配置值> --framework <配置值> --sync-mode incremental`

增量同步仅推送计划中 `syncApis` 列出的接口。全量同步使用 `--sync-mode full`（无需计划）。
