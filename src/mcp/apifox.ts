/**
 * Apifox MCP 连接管理
 *
 * 维护项目名称 → { projectId, apiKey } 的内存映射，并将活跃连接持久化到 .apifoxsync.json。
 * 目前仅支持单项目配置（文件中只存最后一次 connect 的项目）。
 *
 * 连接验证改用 exportOpenApi 探针（官方稳定接口），
 * 原先的 getProjectInfo（/info 端点未收录于 Apifox 开放 API 文档）已移除。
 */

import { configManager } from '../config';
import { apifoxClient } from '../clients/apifoxClient';
import { extractApisFromOpenApiDoc } from '../utils/openapi/openapiWalk';

class ApifoxMCP {
  /** 运行期连接缓存：projectName → { projectId, apiKey, connectedAt? } */
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

  /** 从 .apifoxsync.json 恢复上次已连接的项目。 */
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

  /** 断开时若配置文件中记录的就是该项目，则同步清除凭据。 */
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

  /**
   * 连接到 Apifox 项目并验证凭据。
   *
   * 用 exportOpenApi 做探针验证凭据有效性，成功后将连接信息写入内存缓存和 .apifoxsync.json。
   * 返回 null 表示连接失败。
   */
  async connect(projectName: string, projectId: string, apiKey: string): Promise<any> {
    console.log(`正在连接到 Apifox 项目: ${projectName}`);

    try {
      await apifoxClient.exportOpenApi(projectId, apiKey);
      console.log('✅ 连接成功');

      this.registerConnection(projectName, projectId, apiKey, {
        connectedAt: new Date(),
      });
      this.saveToApifoxSync(projectName, projectId, apiKey);
      console.log('凭据已写入 .apifoxsync.json');

      return { connected: true, projectName, projectId };
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

  /**
   * 获取项目接口列表。
   * includeFullDoc=true 时返回原始 OpenAPI 文档；否则返回解析后的 ApiInfo 数组。
   */
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
