检查已配置项目中本地代码与 Apifox 上现有 API 的差异，只做对比不同步。

步骤：
1. 执行 `npm run build` 确保编译通过
2. 读取 `.apifoxsync.json` 和 `.apifox-credentials.json`
3. 执行 `node dist/index.js scan --scan-type all` 或结合已生成的 `apifox-sync-plan.json`
4. 对比扫描结果与 Apifox 现有接口，汇总差异

仅汇报差异，不执行 sync。
