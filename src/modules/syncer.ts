/**
 * Apifox 同步器
 *
 * 负责与 Apifox 开放 API 交互的所有网络操作：
 *   - 连接验证（用 export-openapi 做探针）
 *   - 获取项目现有接口快照（export-openapi）
 *   - 将格式化后的 OpenAPI 文档导入 Apifox（import-openapi）
 *   - 本地/远程 OpenAPI 文档获取与解析
 */

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
  /**
   * 验证 Apifox 凭据是否可用。
   *
   * 用 exportOpenApi 做探针（官方稳定接口），取代原先未收录的 /info 端点。
   * 凭据解析失败（如未配置）时直接返回 true，不阻塞流程。
   */
  async validateApifoxConnection(projectId: string, apiKey: string, projectName?: string): Promise<boolean> {
    const credentials = resolveApifoxCredentials(projectId, apiKey, projectName);
    if (!credentials) {
      console.log('跳过 Apifox 连接验证');
      return true;
    }

    console.log('正在验证 Apifox 连接...');
    try {
      await apifoxClient.exportOpenApi(credentials.projectId, credentials.apiKey);
      console.log('✅ Apifox 连接验证成功');
      return true;
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      return false;
    }
  }

  /**
   * 获取 Apifox 项目的原始 OpenAPI JSON 文档。
   * 主要用于 scan 阶段生成 apifoxSnapshot，供 LLM 比对。
   * 返回 null 表示获取失败或凭据未配置，调用方应降级处理。
   */
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

  /**
   * 获取 Apifox 项目现有接口列表，用于 sync 阶段目录继承。
   * withFolders=true 时 tags 中包含目录层级，用于推断 folderName。
   */
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

  /**
   * 将格式化后的 OpenAPI 文档导入 Apifox。
   *
   * 固定使用 OVERWRITE_EXISTING 策略，不删除 Apifox 中多余的接口
   * （deleteUnmatchedResources: false），确保增量同步安全。
   * targetBranchId 由调用方传入；不传则写入主分支（main）。
   */
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

  /** 将文档对象保存为 JSON 文件到 temp/ 目录（调试用）。 */
  saveDocToFile(doc: any, filename: string): void {
    const dir = ensureTempDir();
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, JSON.stringify(doc, null, 2));
    appLog(`文档已保存到: ${filePath}`);
  }

  /**
   * 获取并解析 OpenAPI 文档，支持本地文件路径和远程 URL。
   * 本地路径以 ./、../、/ 开头；否则视为 HTTP(S) URL。
   * 同时支持 JSON 和 YAML 格式。
   */
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
