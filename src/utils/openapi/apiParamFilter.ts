import { ApiParameter } from '../../types';

/** Apifox 全局 Header / 鉴权参数，与业务契约无关，对比时忽略 */
const IGNORED_HEADER_PARAM_NAMES = new Set([
  'authorization',
  'useremail',
  'username',
  'cookie',
  'token',
  'accesstoken',
  'x-request-id',
  'x-auth-token',
  'servicetype',
]);

export function isIgnorableApiParam(param: ApiParameter): boolean {
  const name = param.name?.toLowerCase() || '';
  const paramType = (param.type || '').toLowerCase();
  if (paramType === 'header' && IGNORED_HEADER_PARAM_NAMES.has(name)) {
    return true;
  }
  return false;
}

export function getComparableParams(parameters?: ApiParameter[]): ApiParameter[] {
  if (!parameters?.length) {
    return [];
  }
  return parameters.filter((param) => !isIgnorableApiParam(param));
}

export function diffParamNames(
  detectedParams?: ApiParameter[],
  existingParams?: ApiParameter[],
): { added: string[]; removed: string[] } {
  const detectedNames = new Set(getComparableParams(detectedParams).map((param) => param.name));
  const existingNames = new Set(getComparableParams(existingParams).map((param) => param.name));
  return {
    added: [...detectedNames].filter((name) => !existingNames.has(name)),
    removed: [...existingNames].filter((name) => !detectedNames.has(name)),
  };
}
