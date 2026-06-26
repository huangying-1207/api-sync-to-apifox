import { ApiInfo } from '../../types';

/** 规范化路径用于匹配（去除末尾斜杠） */
function normalizeMatchPath(apiPath: string): string {
  return apiPath.replace(/\/$/, '');
}

/** 按 method + path 在列表中查找接口（兼容末尾斜杠差异） */
export function matchApiByMethodPath(apis: ApiInfo[], method: string, apiPath: string): ApiInfo | undefined {
  const normalizedTarget = normalizeMatchPath(apiPath);
  return apis.find(
    (api) =>
      api.method.toLowerCase() === method.toLowerCase() &&
      (api.path === apiPath ||
        api.path === apiPath + '/' ||
        normalizeMatchPath(api.path) === normalizedTarget),
  );
}

/** 解析 "GET:/api/users,POST:/api/orders" 格式的接口列表 */
export function parseApisParam(apisParam: string): Array<{ method: string; path: string }> {
  return apisParam
    .split(',')
    .map((item) => {
      const parts = item.trim().split(':');
      if (parts.length < 2) return null;
      return { method: parts[0].trim(), path: parts.slice(1).join(':').trim() };
    })
    .filter((item): item is { method: string; path: string } => item !== null);
}
