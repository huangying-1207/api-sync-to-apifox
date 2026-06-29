扫描 API 变更并生成同步计划（不同步到 Apifox）。

**完整工作流见** `.cursor/skills/api-sync-to-apifox/SKILL.md`（Step 0～4）。

1. 读取 `.apifoxsync.json` 的 `sync-tool-path`（$TOOL）、`project-name`（$PROJECT）、`apifox-project-id`；缺失时提示 sync-skill 或 `mcp connect`
2. `node $TOOL config init` 合并配置（可选）
3. `node $TOOL workflow --project-name $PROJECT`（或分步 scan + branches --json）
4. 读 `temp/apifox-sync-plan.json`，按 SKILL Step 2 填写 `analysis` / `syncApis`
5. 按 SKILL Step 3 展示 `apifox-sync-plan.md` 与分支列表，等用户回复「确认同步到 \<分支名\>」
