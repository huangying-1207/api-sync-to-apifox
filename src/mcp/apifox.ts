/**
 * Apifox MCP 连接管理
 */

import fs from 'fs';
import path from 'path';
import { apifoxClient } from '../clients/apifoxClient';
import { extractApisFromOpenApiDoc } from '../utils/openapi/openapiWalk';

class ApifoxMCP {
  private connections: Map<string, any>;
  private credentialsPath: string;

  constructor() {
    this.connections = new Map();
    this.credentialsPath = path.join(process.cwd(), '.apifox-credentials.json');
    this.loadCredentials();
  }

  loadCredentials(): void {
    try {
      if (fs.existsSync(this.credentialsPath)) {
        const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
        Object.keys(credentials).forEach((projectName) => {
          this.connections.set(projectName, credentials[projectName]);
        });
        console.log(`已加载 ${this.connections.size} 个项目的连接信息`);
      }
    } catch (error) {
      console.warn('加载凭据文件失败:', (error as Error).message);
    }
  }

  saveCredentials(): void {
    const credentials = Array.from(this.connections.entries()).reduce(
      (acc, [projectName, config]) => {
        acc[projectName] = config;
        return acc;
      },
      {} as Record<string, any>,
    );
    fs.writeFileSync(this.credentialsPath, JSON.stringify(credentials, null, 2));
  }

  async connect(projectName: string, projectId: string, apiKey: string): Promise<any> {
    console.log(`正在连接到 Apifox 项目: ${projectName}`);

    try {
      const projectInfo = await apifoxClient.getProjectInfo(projectId, apiKey);
      console.log('✅ 连接成功');

      this.connections.set(projectName, {
        projectId,
        apiKey,
        projectInfo,
        connectedAt: new Date(),
      });
      this.saveCredentials();
      return projectInfo;
    } catch (error) {
      console.error('❌ 连接失败:', (error as Error).message);
      return null;
    }
  }

  disconnect(projectName: string): void {
    if (this.connections.has(projectName)) {
      this.connections.delete(projectName);
      this.saveCredentials();
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
