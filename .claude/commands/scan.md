扫描 API 变更并生成同步计划（不同步到 Apifox）。

**完整工作流见** `.cursor/skills/api-sync-to-apifox/SKILL.md`（Step 1～4）。

本命令仅执行前置检查 + scan + LLM 分析 + 等待用户确认，不执行 sync：

1. `npm run build`
2. 检查 `.apifox-credentials.json`、`.apifoxsync.json`；缺失时提示 `mcp connect` / `config init`
3. `node dist/index.js config init` 合并配置
4. `node dist/index.js workflow --project-name <项目名>`（或分步 `scan` + `branches --json`）
5. 读 `temp/apifox-sync-plan.json`，按 SKILL Step 2 填写 `analysis` / `syncApis`
6. 按 SKILL Step 3 展示 `apifox-sync-plan.md` 与分支列表，等用户回复「确认同步到 \<分支名\>」
