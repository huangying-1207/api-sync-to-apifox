/**
 * Apifox 开放 API 客户端
 *
 * 仅封装 Apifox 官方文档已收录的稳定接口：
 *   POST /v1/projects/{id}/export-openapi  — 导出 OpenAPI 文档
 *   POST /v1/projects/{id}/import-openapi  — 导入 OpenAPI 文档
 *   GET  /v1/projects/{id}/documents       — 文档列表（非核心，仅 MCP 展示用）
 *   GET  /v1/projects/{id}/environments    — 环境列表（非核心，仅 MCP 展示用）
 *   GET  /v1/projects/{id}/variables       — 变量列表（非核心，仅 MCP 展示用）
 *
 * ⚠️  历史遗留的 GET /v1/projects/{id}/info 在 Apifox 开放 API 文档中未收录，
 *     已删除，改由 exportOpenApi 代替做连接探针。
 */

import axios from 'axios';
import { APIFOX_API_BASE_URL } from '../config';
import { ErrorHandler } from '../utils/errorHandler';
import { retryRequest } from '../utils/helper';

const API_VERSION = '2024-03-28';
const REQUEST_TIMEOUT = 60000;

export class ApifoxClient {
  private baseUrl: string;

  constructor(baseUrl: string = APIFOX_API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Apifox-Api-Version': API_VERSION,
    };
  }

  /**
   * 导出项目全量 OpenAPI 文档（JSON 格式，OAS 3.1）。
   *
   * 也用作连接探针：能正常返回则说明 projectId + apiKey 有效。
   * addFoldersToTags 为 true 时，接口目录会体现在 tags 字段，用于同步时继承 Apifox 目录结构。
   */
  async exportOpenApi(
    projectId: string,
    apiKey: string,
    options?: { addFoldersToTags?: boolean },
  ): Promise<any> {
    const response = await retryRequest(() =>
      axios.post(
        `${this.baseUrl}/v1/projects/${projectId}/export-openapi`,
        {
          scope: { type: 'ALL' },
          options: {
            includeApifoxExtensionProperties: false,
            addFoldersToTags: options?.addFoldersToTags === true,
          },
          oasVersion: '3.1',
          exportFormat: 'JSON',
        },
        {
          headers: this.headers(apiKey),
          timeout: REQUEST_TIMEOUT,
        },
      ),
    );
    return response.data;
  }

  /**
   * 导入 OpenAPI 文档到 Apifox 项目。
   * importOptions 由调用方组装（覆盖策略、目标分支 ID 等），此处透传。
   */
  async importOpenApi(
    projectId: string,
    apiKey: string,
    doc: any,
    importOptions: Record<string, unknown>,
  ): Promise<any> {
    const response = await retryRequest(() =>
      axios.post(
        `${this.baseUrl}/v1/projects/${projectId}/import-openapi`,
        {
          input: JSON.stringify(doc),
          options: importOptions,
        },
        {
          headers: this.headers(apiKey),
          timeout: REQUEST_TIMEOUT,
        },
      ),
    );
    return response.data;
  }

  /** 获取项目文档列表（用于 MCP 展示，非同步核心路径）。 */
  async getDocuments(projectId: string, apiKey: string): Promise<any[]> {
    try {
      const response = await retryRequest(() =>
        axios.get(`${this.baseUrl}/v1/projects/${projectId}/documents`, {
          headers: this.headers(apiKey),
          timeout: REQUEST_TIMEOUT,
        }),
      );
      if (response.status === 200) {
        return Array.isArray(response.data) ? response.data : response.data.documents || [];
      }
      return [];
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      return [];
    }
  }

  /** 获取项目环境列表（用于 MCP 展示，非同步核心路径）。 */
  async getEnvironments(projectId: string, apiKey: string): Promise<any[]> {
    try {
      const response = await retryRequest(() =>
        axios.get(`${this.baseUrl}/v1/projects/${projectId}/environments`, {
          headers: this.headers(apiKey),
          timeout: REQUEST_TIMEOUT,
        }),
      );
      if (response.status === 200) {
        return Array.isArray(response.data) ? response.data : response.data.environments || [];
      }
      return [];
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      return [];
    }
  }

  /** 获取项目变量列表（用于 MCP 展示，非同步核心路径）。 */
  async getVariables(projectId: string, apiKey: string): Promise<any[]> {
    try {
      const response = await retryRequest(() =>
        axios.get(`${this.baseUrl}/v1/projects/${projectId}/variables`, {
          headers: this.headers(apiKey),
          timeout: REQUEST_TIMEOUT,
        }),
      );
      if (response.status === 200) {
        return Array.isArray(response.data) ? response.data : response.data.variables || [];
      }
      return [];
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      return [];
    }
  }
}

export const apifoxClient = new ApifoxClient();
