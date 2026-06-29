import path from 'path';
import { ApiInfo } from '../../types';
import { buildApiMapKey } from '../openapi/apiKey';

export interface ControllerFolderMeta {
  controllerClassName: string;
  controllerTag?: string;
}

/** 从 Controller 源码解析类名与 @Api/@Tag 分组名 */
export function extractControllerFolderMeta(content: string, fileName: string): ControllerFolderMeta {
  const controllerClassName = path.basename(fileName, path.extname(fileName));

  const apiTagSingle = content.match(/@Api\s*\(\s*tags\s*=\s*"([^"]+)"/);
  if (apiTagSingle?.[1]) {
    return { controllerClassName, controllerTag: apiTagSingle[1].trim() };
  }

  const apiTagSingleQuote = content.match(/@Api\s*\(\s*tags\s*=\s*'([^']+)'/);
  if (apiTagSingleQuote?.[1]) {
    return { controllerClassName, controllerTag: apiTagSingleQuote[1].trim() };
  }

  const apiTagArray = content.match(/@Api\s*\(\s*tags\s*=\s*\{\s*"([^"]+)"/);
  if (apiTagArray?.[1]) {
    return { controllerClassName, controllerTag: apiTagArray[1].trim() };
  }

  const tagName = content.match(/@Tag\s*\(\s*name\s*=\s*"([^"]+)"/);
  if (tagName?.[1]) {
    return { controllerClassName, controllerTag: tagName[1].trim() };
  }

  const tagNameQuote = content.match(/@Tag\s*\(\s*name\s*=\s*'([^']+)'/);
  if (tagNameQuote?.[1]) {
    return { controllerClassName, controllerTag: tagNameQuote[1].trim() };
  }

  return { controllerClassName };
}

/** 默认文件夹名：优先注解 tags，否则 Controller 类名 */
export function getDefaultControllerFolderName(api: ApiInfo): string {
  return (
    api.controllerTag ||
    api.controllerClassName ||
    api.controller?.replace(/\.(java|ts|js)$/i, '') ||
    '未分组'
  );
}

/**
 * 从全量扫描结果与 Apifox 已有接口，建立 Controller → 目录 映射
 */
function buildControllerFolderMap(
  existingApis: ApiInfo[],
  allScannedApis: ApiInfo[],
): Map<string, string> {
  const existingByKey = new Map<string, ApiInfo>();
  for (const api of existingApis) {
    existingByKey.set(buildApiMapKey(api.method, api.path), api);
  }

  const controllerFolderMap = new Map<string, string>();
  for (const scanned of allScannedApis) {
    if (!scanned.controller) continue;
    const existing = existingByKey.get(buildApiMapKey(scanned.method, scanned.path));
    if (existing?.folderName && !controllerFolderMap.has(scanned.controller)) {
      controllerFolderMap.set(scanned.controller, existing.folderName);
    }
  }
  return controllerFolderMap;
}

/**
 * 为待同步接口解析 Apifox 目录（OpenAPI tags 第一项）
 * - 已存在接口：保留 Apifox 当前目录
 * - 新增接口：同 Controller 已有接口所在目录；否则用注解或类名新建目录
 */
export function resolveEndpointFolders(
  apis: ApiInfo[],
  existingApis: ApiInfo[] = [],
  allScannedApis: ApiInfo[] = apis,
): void {
  const existingByKey = new Map<string, ApiInfo>();
  for (const api of existingApis) {
    existingByKey.set(buildApiMapKey(api.method, api.path), api);
  }

  const controllerFolderMap = buildControllerFolderMap(existingApis, allScannedApis);

  for (const api of apis) {
    const existing = existingByKey.get(buildApiMapKey(api.method, api.path));
    if (existing?.folderName) {
      api.folderName = existing.folderName;
      api.isNewEndpoint = false;
      continue;
    }

    api.isNewEndpoint = true;
    if (api.controller && controllerFolderMap.has(api.controller)) {
      api.folderName = controllerFolderMap.get(api.controller)!;
      continue;
    }

    api.folderName = getDefaultControllerFolderName(api);
    if (api.controller) {
      controllerFolderMap.set(api.controller, api.folderName);
    }
  }
}
