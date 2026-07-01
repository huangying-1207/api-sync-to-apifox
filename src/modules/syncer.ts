import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { apifoxClient } from '../clients/apifoxClient';
import { ErrorHandler } from '../utils/errorHandler';
import { retryRequest } from '../utils/helper';
import { resolveApifoxCredentials } from '../utils/apifox/credentials';
import { ensureTempDir } from '../utils/apifox/syncPlan';
import { extractApisFromOpenApiDoc } from '../utils/openapi/openapiWalk';
import { appLog } from '../utils/logger';
import { ApiInfo } from '../types';

class ApifoxSyncer {
  async validateApifoxConnection(projectId: string, apiKey: string, projectName?: string): Promise<boolean> {
    const credentials = resolveApifoxCredentials(projectId, apiKey, projectName);
    if (!credentials) {
      console.log('跳过 Apifox 连接验证');
      return true;
    }

    console.log('正在验证 Apifox 连接...');
    try {
      await apifoxClient.getProjectInfo(credentials.projectId, credentials.apiKey);
      console.log('✅ Apifox 连接验证成功');
      return true;
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      return false;
    }
  }

  async getApifoxOpenApiJson(projectId: string, apiKey: string, projectName?: string): Promise<any> {
    const credentials = resolveApifoxCredentials(projectId, apiKey, projectName);
    if (!credentials) return null;
    try {
      const doc = await apifoxClient.exportOpenApi(credentials.projectId, credentials.apiKey);
      if (!doc || typeof doc === 'string') return null;
      return doc;
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      return null;
    }
  }

  async getApifoxExistingApis(
    projectId: string,
    apiKey: string,
    projectName?: string,
    withFolders = false,
  ): Promise<ApiInfo[]> {
    const credentials = resolveApifoxCredentials(projectId, apiKey, projectName);
    if (!credentials) return [];

    try {
      const openApiDoc = await apifoxClient.exportOpenApi(
        credentials.projectId,
        credentials.apiKey,
        { addFoldersToTags: withFolders },
      );
      if (!openApiDoc || typeof openApiDoc === 'string') {
        console.warn('警告：未获取到 Apifox 现有接口信息，将同步所有检测到的接口');
        return [];
      }
      return extractApisFromOpenApiDoc(openApiDoc, true);
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      ErrorHandler.logError(error, { projectId, operation: 'getExistingApis' });
      throw error;
    }
  }

  async syncToApifox(
    doc: any,
    projectId: string,
    apiKey: string,
    projectName?: string,
    syncOptions?: { targetBranchId?: number; targetBranchName?: string },
  ): Promise<any> {
    const credentials = resolveApifoxCredentials(projectId, apiKey, projectName);
    if (!credentials) {
      console.error(`❌ 无法解析 Apifox 凭据`);
      return null;
    }

    if (projectName) {
      console.log(`正在同步 API 文档到 Apifox 项目: ${projectName} (ID: ${credentials.projectId})`);
    } else {
      console.log(`正在同步 API 文档到 Apifox 项目: ${credentials.projectId}`);
    }

    const importOptions: Record<string, unknown> = {
      endpointOverwriteBehavior: 'OVERWRITE_EXISTING',
      schemaOverwriteBehavior: 'OVERWRITE_EXISTING',
      updateFolderOfChangedEndpoint: true,
      prependBasePath: false,
      deleteUnmatchedResources: false,
    };

    if (syncOptions?.targetBranchId !== undefined) {
      importOptions.targetBranchId = syncOptions.targetBranchId;
      const branchLabel = syncOptions.targetBranchName || `ID ${syncOptions.targetBranchId}`;
      console.log(`目标 Apifox 分支: ${branchLabel}`);
    } else {
      console.log('目标 Apifox 分支: main（主分支，默认）');
    }

    try {
      const result = await apifoxClient.importOpenApi(
        credentials.projectId,
        credentials.apiKey,
        doc,
        importOptions,
      );
      console.log('API 文档同步成功');
      console.log('同步结果:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      ErrorHandler.logError(error, { projectId, operation: 'syncToApifox' });
      throw error;
    }
  }

  saveDocToFile(doc: any, filename: string): void {
    const dir = ensureTempDir();
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, JSON.stringify(doc, null, 2));
    appLog(`文档已保存到: ${filePath}`);
  }

  async getOpenApiDoc(url: string): Promise<any> {
    console.log(`正在获取 OpenAPI 文档: ${url}`);

    try {
      let doc: any;

      if (url.startsWith('./') || url.startsWith('../') || url.startsWith('/')) {
        console.log('检测到本地文件，读取文件内容...');
        const content = fs.readFileSync(url, 'utf8');
        try {
          doc = require('yaml').parse(content);
        } catch (_e) {
          doc = JSON.parse(content);
        }
      } else {
        const response = await retryRequest(() => axios.get(url, { timeout: 60000 }));
        if (typeof response.data === 'string') {
          try {
            doc = require('yaml').parse(response.data);
          } catch (_e) {
            doc = JSON.parse(response.data);
          }
        } else {
          doc = response.data;
        }
      }

      console.log('API 文档获取成功');
      return doc;
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      ErrorHandler.logError(error, { url, operation: 'getOpenApiDoc' });
      throw error;
    }
  }

  extractApisFromDoc(doc: any): ApiInfo[] {
    return extractApisFromOpenApiDoc(doc, false);
  }
}

export default ApifoxSyncer;
