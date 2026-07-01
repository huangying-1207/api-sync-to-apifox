import { ApiInfo } from '../../types';

const VOID_GENERIC_TYPES = new Set(['void', 'Void', 'java.lang.Void']);

/** 提取 ResponseEntity<T> 中的 T */
export function extractResponseEntityGeneric(returnType?: string): string | undefined {
  const match = returnType?.trim().match(/^ResponseEntity\s*<(.+)>\s*$/);
  return match ? match[1].trim() : undefined;
}

export function isResponseEntityVoid(returnType?: string): boolean {
  const inner = extractResponseEntityGeneric(returnType);
  return inner ? VOID_GENERIC_TYPES.has(inner) : false;
}

export function isVoidReturnType(returnType?: string): boolean {
  const trimmed = returnType?.trim();
  if (!trimmed) return false;
  return trimmed === 'void' || isResponseEntityVoid(trimmed);
}

/** 从方法体推断 ResponseEntity 无 body 时的 HTTP 状态码 */
export function resolveResponseEntityStatusCode(methodContent: string): string | undefined {
  if (/ResponseEntity\.noContent\s*\(\s*\)/.test(methodContent)) {
    return '204';
  }
  if (/ResponseEntity\.status\s*\(\s*HttpStatus\.NO_CONTENT\s*\)/.test(methodContent)) {
    return '204';
  }
  if (/ResponseEntity\.status\s*\(\s*HttpStatus\.CREATED\s*\)/.test(methodContent)) {
    return '201';
  }
  if (/ResponseEntity\.ok\s*\(\s*\)\s*\.build\s*\(\s*\)/.test(methodContent)) {
    return '200';
  }
  return undefined;
}

/** 是否为无响应体接口（void / ResponseEntity<Void> 或已标记） */
export function isNoResponseBodyApi(api: ApiInfo): boolean {
  return api.noResponseBody === true || isVoidReturnType(api.returnType);
}
