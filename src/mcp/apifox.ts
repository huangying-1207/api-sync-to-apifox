/**
 * Apifox MCP 连接管理（凭据统一读写 .apifoxsync.json）
 */

import { configManager } from '../config';
import { apifoxClient } from '../clients/apifoxClient';
import { extractApisFromOpenApiDoc } from '../utils/openapi/openapiWalk';

class ApifoxMCP {
  private connections: Map<string, any>;

  constructor() {
    this.connections = new Map();
    this.loadCredentials();
  }

  private registerConnection(projectName: string, projectId: string, apiKey: string, extra: Record<string, unknown> = {}): void {
    this.connections.set(projectName, {
      projectId,
      apiKey,
      ...extra,
    });
  }

  private loadFromApifoxSync(): boolean {
    const config = configManager.readConfig();
    if (!config) return false;

    const projectName = config['project-name'];
    const projectId = config['apifox-project-id'];
    const apiKey = config['apifox-api-key'];
    if (!projectName || !projectId || !apiKey) return false;

    this.registerConnection(projectName, projectId, apiKey);
    return true;
  }

  private saveToApifoxSync(projectName: string, projectId: string, apiKey: string): void {
    configManager.setConfig('project-name', projectName);
    configManager.setConfig('apifox-project-id', projectId);
    configManager.setConfig('apifox-api-key', apiKey);
    configManager.saveConfig();
  }

  private clearApifoxSyncIfMatches(projectName: string): void {
    const config = configManager.readConfig();
    if (config?.['project-name'] === projectName) {
      configManager.setConfig('apifox-project-id', '');
      configManager.setConfig('apifox-api-key', '');
      configManager.saveConfig();
    }
  }

  loadCredentials(verbose = false): void {
    this.connections.clear();
    this.loadFromApifoxSync();
    if (verbose && this.connections.size > 0) {
      console.log(`已从 .apifoxsync.json 加载 ${this.connections.size} 个 Apifox 项目连接`);
    }
  }

  async connect(projectName: string, projectId: string, apiKey: string): Promise<any> {
    console.log(`正在连接到 Apifox 项目: ${projectName}`);

    try {
      const projectInfo = await apifoxClient.getProjectInfo(projectId, apiKey);
      console.log('✅ 连接成功');

      this.registerConnection(projectName, projectId, apiKey, {
        projectInfo,
        connectedAt: new Date(),
      });
      this.saveToApifoxSync(projectName, projectId, apiKey);
      console.log('凭据已写入 .apifoxsync.json');
      return projectInfo;
    } catch (error) {
      console.error('❌ 连接失败:', (error as Error).message);
      return null;
    }
  }

  disconnect(projectName: string): void {
    if (this.connections.has(projectName)) {
      this.connections.delete(projectName);
      this.clearApifoxSyncIfMatches(projectName);
      console.log(`已断开与项目 "${projectName}" 的连接`);
    } else {
      console.warn(`项目 "${projectName}" 未连接`);
    }
  }

  isConnected(projectName: string): boolean {
    return this.connections.has(projectName);
  }

  getConnectionInfo(projectName: string): any {
    return this.connections.get(projectName);
  }

  getConnectedProjects(): string[] {
    return Array.from(this.connections.keys());
  }

  async getProjectApis(projectName: string, includeFullDoc: boolean = false): Promise<any> {
    const connectionInfo = this.connections.get(projectName);
    if (!connectionInfo) {
      console.error(`项目 "${projectName}" 未连接`);
      return null;
    }

    try {
      const openApiDoc = await apifoxClient.exportOpenApi(connectionInfo.projectId, connectionInfo.apiKey);
      if (!openApiDoc) return null;
      if (includeFullDoc) return openApiDoc;
      return extractApisFromOpenApiDoc(openApiDoc, false);
    } catch (error) {
      console.error('获取项目接口信息失败:', (error as Error).message);
      return null;
    }
  }

  async getProjectDocuments(projectName: string): Promise<any[]> {
    const connectionInfo = this.connections.get(projectName);
    if (!connectionInfo) {
      console.error(`项目 "${projectName}" 未连接`);
      return [];
    }
    return apifoxClient.getDocuments(connectionInfo.projectId, connectionInfo.apiKey);
  }

  async getProjectEnvironments(projectName: string): Promise<any[]> {
    const connectionInfo = this.connections.get(projectName);
    if (!connectionInfo) {
      console.error(`项目 "${projectName}" 未连接`);
      return [];
    }
    return apifoxClient.getEnvironments(connectionInfo.projectId, connectionInfo.apiKey);
  }

  async getProjectVariables(projectName: string): Promise<any[]> {
    const connectionInfo = this.connections.get(projectName);
    if (!connectionInfo) {
      console.error(`项目 "${projectName}" 未连接`);
      return [];
    }
    return apifoxClient.getVariables(connectionInfo.projectId, connectionInfo.apiKey);
  }
}

const apifoxMCP = new ApifoxMCP();
export default apifoxMCP;
