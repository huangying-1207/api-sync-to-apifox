扫描已配置项目的 API 变更，生成 LLM 分析用的变更文档（不同步）。

步骤：
1. 执行 `npm run build` 确保编译通过
2. 检查前置条件：
   - 读取 `.apifox-credentials.json`，检查是否有 MCP 连接信息
   - 读取 `.apifoxsync.json`，检查配置是否完整（source-path、framework 等是否有有效值）
   - 如果缺少 MCP 连接信息：提示用户先执行 `node dist/index.js mcp connect <项目名> <项目ID> <API密钥>`
   - 如果配置文件缺失：提示用户执行 `node dist/index.js config init --source-path <源码路径> --framework <框架>`
3. 执行 `node dist/index.js config init` 合并配置
4. 执行 `node dist/index.js scan --source-type <配置值> --source-path <配置值> --framework <配置值> --scan-type changed`
5. 读取 `temp/apifox-sync-plan.json` 和 `git diff`，由 LLM 分析变更对 Controller 接口的影响
6. 更新 `apifox-sync-plan.json` 中的 `analysis` 和 `syncApis`，生成/更新 `apifox-sync-plan.md`
7. 向用户展示变更文档，等待用户明确确认后再执行 sync

汇报：变更文件列表、LLM 分析结果、待同步接口列表。
