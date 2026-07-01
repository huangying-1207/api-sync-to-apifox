import { ApiInfo } from '../../types';

export interface ApifoxApiSnapshotItem {
  method: string;
  path: string;
  summary?: string;
  parameters?: string[];
  requestBodyType?: string;
  responseFields?: string[];
  responseStatusCode?: string;
}

/** 将 Apifox 现有接口压缩为 LLM 可读的对比快照 */
export function buildApifoxApiSnapshot(existingApis: ApiInfo[]): ApifoxApiSnapshotItem[] {
  return existingApis
    .map((api) => ({
      method: api.method.toUpperCase(),
      path: api.path,
      summary: api.summary,
      parameters: api.parameters?.map((param) => `${param.type}:${param.name}`),
      requestBodyType: api.requestBodyType,
      responseFields: api.responseFields && api.responseFields.length > 0 ? api.responseFields : undefined,
      responseStatusCode: api.responseStatusCode,
    }))
    .sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`));
}
