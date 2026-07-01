import { ApiInfo } from '../../types';
import { normalizePath } from '../helper';

/** 构建 API 在 Map 中的统一键（method 小写 + 规范化路径） */
export function buildApiMapKey(method: string, apiPath: string): string {
  return `${method.toLowerCase()}:${normalizePath(apiPath)}`;
}

/** 按 method + path 去重，保留首次出现的接口 */
export function dedupeApis(apis: ApiInfo[]): ApiInfo[] {
  const seen = new Map<string, ApiInfo>();
  for (const api of apis) {
    const key = buildApiMapKey(api.method, api.path);
    if (!seen.has(key)) {
      seen.set(key, api);
    }
  }
  return [...seen.values()];
}
