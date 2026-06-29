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

  async getProjectInfo(projectId: string, apiKey: string): Promise<any> {
    const response = await retryRequest(() =>
      axios.get(`${this.baseUrl}/v1/projects/${projectId}/info`, {
        headers: this.headers(apiKey),
        timeout: REQUEST_TIMEOUT,
      }),
    );
    return response.data;
  }

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
