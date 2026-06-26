import apifoxMCP from '../../mcp/apifox';

export interface ResolvedCredentials {
  projectId: string;
  apiKey: string;
}

/** 解析 Apifox 凭据：CLI 参数优先，project-name 时从 MCP 凭据读取 */
export function resolveApifoxCredentials(
  projectId: string,
  apiKey: string,
  projectName?: string,
): ResolvedCredentials | null {
  if (projectName) {
    if (!apifoxMCP.isConnected(projectName)) {
      console.error(`❌ 项目 "${projectName}" 未连接`);
      return null;
    }
    const connectionInfo = apifoxMCP.getConnectionInfo(projectName);
    return {
      projectId: connectionInfo.projectId,
      apiKey: connectionInfo.apiKey,
    };
  }

  if (!projectId || !apiKey) {
    return null;
  }

  return { projectId, apiKey };
}
