将已确认的接口变更同步到 Apifox。

**完整工作流见** `.cursor/skills/api-sync-to-apifox/SKILL.md`（Step 4）。

1. 读取 `.apifoxsync.json` 的 `sync-tool-path`（$TOOL）
2. 检查 `temp/apifox-sync-plan.json`：`userConfirmed === true` 且 `status === confirmed`，且含 `targetBranch`
3. 若未确认：先走 `/scan`，不得直接 sync
4. `node $TOOL sync --sync-mode incremental`

全量同步（无需计划）：`node $TOOL sync --sync-mode full`
