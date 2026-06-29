import path from 'path';
import { ApiInfo } from '../../types';
import { buildApiMapKey } from '../openapi/apiKey';

export interface ControllerFolderMeta {
  controllerClassName: string;
  controllerTag?: string;
}

function stripJavaComments(content: string): string {
  let result = '';
  let inBlockComment = false;
  let inLineComment = false;
  let inString: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
      result += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    result += char;
  }

  return result;
}

function extractAnnotationValue(content: string, annotationName: string, fieldName: string): string | undefined {
  const annotation = content.match(new RegExp(`@${annotationName}\\s*\\(([\\s\\S]*?)\\)`));
  const annotationBody = annotation?.[1];
  if (!annotationBody) return undefined;

  const value = annotationBody.match(new RegExp(`${fieldName}\\s*=\\s*(?:\\{\\s*)?["']([^"']+)["']`));
  return value?.[1]?.trim();
}

function getControllerFolderKey(api: ApiInfo): string | undefined {
  return (
    api.controllerKey ||
    api.file?.replace(/\\/g, '/').toLowerCase() ||
    api.controller ||
    api.controllerClassName
  );
}

/** 从 Controller 源码解析类名与 @Api/@Tag 分组名 */
export function extractControllerFolderMeta(content: string, fileName: string): ControllerFolderMeta {
  const controllerClassName = path.basename(fileName, path.extname(fileName));
  const uncommentedContent = stripJavaComments(content);

  const controllerTag =
    extractAnnotationValue(uncommentedContent, 'Api', 'tags') ||
    extractAnnotationValue(uncommentedContent, 'Tag', 'name') ||
    extractAnnotationValue(uncommentedContent, 'Api', 'value');
  if (controllerTag) {
    return { controllerClassName, controllerTag };
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
    const controllerKey = getControllerFolderKey(scanned);
    if (!controllerKey) continue;
    const existing = existingByKey.get(buildApiMapKey(scanned.method, scanned.path));
    if (existing?.folderName && !controllerFolderMap.has(controllerKey)) {
      controllerFolderMap.set(controllerKey, existing.folderName);
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
    const controllerKey = getControllerFolderKey(api);
    if (controllerKey && controllerFolderMap.has(controllerKey)) {
      api.folderName = controllerFolderMap.get(controllerKey)!;
      continue;
    }

    api.folderName = getDefaultControllerFolderName(api);
    if (controllerKey) {
      controllerFolderMap.set(controllerKey, api.folderName);
    }
  }
}
