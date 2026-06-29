检查已配置项目中本地代码与 Apifox 上现有 API 的差异，只做对比不同步。

步骤：
1. 执行 `npm run build` 确保编译通过
2. 读取 `.apifoxsync.json` 和 `.apifox-credentials.json`，确认凭据与 source-path 有效
3. 执行 `node dist/index.js scan --source-type code --source-path <配置值> --framework <配置值> --scan-type all`
   - 若已配置 Apifox 凭据，scan 会自动与 Apifox 对比并输出新增/更新/删除统计
4. 读取 `temp/apifox-sync-plan.json`（若存在）汇总差异

仅汇报差异，不执行 sync，不将计划标记为 confirmed。
