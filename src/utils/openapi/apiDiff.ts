import { diffParamNames } from './apiParamFilter';
import { normalizePath } from '../helper';
import { ApiInfo } from '../../types';

const JAVA_TO_OPENAPI_TYPE_MAP: Record<string, string> = {
  String: 'string',
  Integer: 'integer',
  Long: 'integer',
  Double: 'number',
  Float: 'number',
  Boolean: 'boolean',
  Object: 'object',
  int: 'integer',
  long: 'integer',
  double: 'number',
  float: 'number',
  boolean: 'boolean',
};

export interface ApiDiffResult {
  hasChanges: boolean;
  descriptions: string[];
}

function comparePathParams(detectedApi: ApiInfo, existingApi: ApiInfo): string[] {
  const changes: string[] = [];
  const detectedParams = detectedApi.path.match(/\{[^}]+\}/g) || [];
  const existingParams = existingApi.path.match(/\{[^}]+\}/g) || [];

  if (detectedParams.length !== existingParams.length) {
    changes.push(`参数数量: 从 ${existingParams.length} 变为 ${detectedParams.length}`);
  } else {
    const detectedParamSet = new Set(detectedParams.map((p) => p.replace(/[{}]/g, '')));
    const existingParamSet = new Set(existingParams.map((p) => p.replace(/[{}]/g, '')));
    const paramDiff = [...detectedParamSet]
      .filter((x) => !existingParamSet.has(x))
      .concat([...existingParamSet].filter((x) => !detectedParamSet.has(x)));
    if (paramDiff.length > 0) {
      changes.push(`参数变更: ${paramDiff.join(', ')}`);
    }
  }
  return changes;
}

function compareReturnType(detectedApi: ApiInfo, existingApi: ApiInfo, verbose: boolean): string[] {
  const changes: string[] = [];
  if (!detectedApi.returnType || !existingApi.returnType || detectedApi.returnType === existingApi.returnType) {
    return changes;
  }

  const detectedNormalized =
    JAVA_TO_OPENAPI_TYPE_MAP[detectedApi.returnType] || detectedApi.returnType.toLowerCase();
  const existingNormalized = existingApi.returnType.toLowerCase();
  const isExistingGeneric = existingNormalized === 'object' || existingNormalized === 'array';
  const isDetectedGeneric = detectedNormalized === 'object' || detectedNormalized === 'array';
  const isTypeMappingMatch = JAVA_TO_OPENAPI_TYPE_MAP[detectedApi.returnType] === existingNormalized;
  const isObjectVsWrapper =
    (isExistingGeneric && !isDetectedGeneric) || (isDetectedGeneric && !isExistingGeneric);

  if (isObjectVsWrapper || isTypeMappingMatch || detectedNormalized === existingNormalized) {
    return changes;
  }

  if (verbose) {
    changes.push(`返回类型: 从 ${existingApi.returnType} 变为 ${detectedApi.returnType}`);
  } else {
    changes.push('returnType changed');
  }
  return changes;
}

function compareResponseFields(detectedApi: ApiInfo, existingApi: ApiInfo, verbose: boolean): string[] {
  const changes: string[] = [];

  if (detectedApi.responseFields && existingApi.responseFields) {
    const detectedFieldSet = new Set(detectedApi.responseFields);
    const existingFieldSet = new Set(existingApi.responseFields);
    const addedFields = [...detectedFieldSet].filter((x) => !existingFieldSet.has(x));
    const removedFields = [...existingFieldSet].filter((x) => !detectedFieldSet.has(x));

    if (verbose) {
      if (addedFields.length > 0) changes.push(`新增响应字段: ${addedFields.join(', ')}`);
      if (removedFields.length > 0) changes.push(`删除响应字段: ${removedFields.join(', ')}`);
    } else if (addedFields.length > 0 || removedFields.length > 0) {
      changes.push('responseFields changed');
    }
  } else if (detectedApi.responseFields?.length && !existingApi.responseFields?.length) {
    if (verbose) {
      changes.push(`新增响应字段: ${detectedApi.responseFields.join(', ')}`);
    } else {
      changes.push('responseFields changed');
    }
  }

  return changes;
}

/** 比较两个接口的差异，verbose 为 true 时返回可读描述 */
export function computeApiDiff(detectedApi: ApiInfo, existingApi: ApiInfo, verbose = false): ApiDiffResult {
  const descriptions: string[] = [];

  descriptions.push(...comparePathParams(detectedApi, existingApi));

  if (detectedApi.method.toLowerCase() !== existingApi.method.toLowerCase()) {
    descriptions.push(
      verbose
        ? `方法: 从 ${existingApi.method.toUpperCase()} 变为 ${detectedApi.method.toUpperCase()}`
        : 'method changed',
    );
  }

  if (normalizePath(detectedApi.path) !== normalizePath(existingApi.path)) {
    descriptions.push(
      verbose ? `路径: 从 ${existingApi.path} 变为 ${detectedApi.path}` : 'path changed',
    );
  }

  const paramDiff = diffParamNames(detectedApi.parameters, existingApi.parameters);
  if (paramDiff.added.length > 0) {
    descriptions.push(verbose ? `新增参数: ${paramDiff.added.join(', ')}` : 'params added');
  }
  if (paramDiff.removed.length > 0) {
    descriptions.push(verbose ? `删除参数: ${paramDiff.removed.join(', ')}` : 'params removed');
  }

  descriptions.push(...compareReturnType(detectedApi, existingApi, verbose));

  if (
    verbose &&
    detectedApi.controller &&
    existingApi.controller &&
    detectedApi.controller !== existingApi.controller
  ) {
    descriptions.push(`控制器: 从 ${existingApi.controller} 变为 ${detectedApi.controller}`);
  }

  descriptions.push(...compareResponseFields(detectedApi, existingApi, verbose));

  return { hasChanges: descriptions.length > 0, descriptions };
}
