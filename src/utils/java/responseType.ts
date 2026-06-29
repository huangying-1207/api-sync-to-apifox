/** 判断 Java 返回类型是否为统一响应包装 Response */
export function isResponseReturnType(returnType: string): boolean {
  const normalized = returnType.trim();
  return normalized === 'Response' || /^Response\s*<[^>]+>\s*$/.test(normalized);
}

/** 从 Response<T> 签名中提取 T */
export function extractResponseGenericType(returnType: string): string | undefined {
  const match = returnType.trim().match(/^Response\s*<(.+)>\s*$/);
  return match ? match[1].trim() : undefined;
}
