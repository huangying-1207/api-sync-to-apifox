import path from 'path';
import { configManager } from '../config';
import { ConfigValidator } from '../utils/configValidator';
import apifoxMCP from '../mcp/apifox';

export function handleConfigInit(stripArgv: string[]): void {
  const optionArgs = stripArgv[0] === 'init' ? stripArgv.slice(1) : stripArgv;
  const initArgs: Record<string, string> = {};

  for (let i = 0; i < optionArgs.length; i++) {
    if (optionArgs[i].startsWith('--') && i + 1 < optionArgs.length && !optionArgs[i + 1].startsWith('--')) {
      initArgs[optionArgs[i].slice(2)] = optionArgs[i + 1];
      i++;
    }
  }

  const connectedProjects = apifoxMCP.getConnectedProjects();
  if (connectedProjects.length > 0) {
    const existingProjectName = configManager.getConfig('project-name') as string | undefined;
    const projectName =
      existingProjectName && connectedProjects.includes(existingProjectName)
        ? existingProjectName
        : connectedProjects[0];
    const connectionInfo = apifoxMCP.getConnectionInfo(projectName);
    initArgs['project-name'] = projectName;
    initArgs['apifox-project-id'] = connectionInfo.projectId;
    initArgs['apifox-api-key'] = connectionInfo.apiKey;
    console.log(`已从凭据中加载项目 "${projectName}" 的连接信息`);
  } else {
    console.warn('未检测到 MCP 连接信息，请先执行 mcp connect 连接 Apifox 项目');
  }

  const defaultConfig = ConfigValidator.generateDefaultConfig();
  const existingConfig = configManager.getAllConfig();
  const mergedConfig = { ...defaultConfig, ...existingConfig, ...initArgs };

  configManager.setConfig('apifox-project-id', mergedConfig['apifox-project-id']);
  configManager.setConfig('apifox-api-key', mergedConfig['apifox-api-key']);
  if (mergedConfig['project-name']) configManager.setConfig('project-name', mergedConfig['project-name']);
  if (mergedConfig['source-type']) configManager.setConfig('source-type', mergedConfig['source-type']);
  if (mergedConfig['source-path']) configManager.setConfig('source-path', mergedConfig['source-path']);
  if (mergedConfig['framework']) configManager.setConfig('framework', mergedConfig['framework']);
  if (mergedConfig['sync-mode']) configManager.setConfig('sync-mode', mergedConfig['sync-mode']);
  if (mergedConfig['scan-type']) configManager.setConfig('scan-type', mergedConfig['scan-type']);
  if (mergedConfig['trigger-mode']) configManager.setConfig('trigger-mode', mergedConfig['trigger-mode']);
  configManager.saveConfig();
  console.log(`配置文件已更新: ${path.join(process.cwd(), '.apifoxsync.json')}`);
}
