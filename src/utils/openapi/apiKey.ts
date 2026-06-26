import { normalizePath } from '../helper';

/** 构建 API 在 Map 中的统一键（method 小写 + 规范化路径） */
export function buildApiMapKey(method: string, apiPath: string): string {
  return `${method.toLowerCase()}:${normalizePath(apiPath)}`;
}
