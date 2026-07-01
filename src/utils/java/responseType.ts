export type DtoFieldMap = Record<string, string>;
export type DtoSchemaMap = Record<string, DtoFieldMap>;

/** 去掉泛型参数，得到简单类名，如 Response<Map<...>> → Response */
export function extractBaseTypeName(returnType: string | undefined): string {
  if (!returnType?.trim()) return 'Object';
  const normalized = returnType.trim();
  const generic = normalized.match(/^(\w+)\s*<.+>$/);
  return generic ? generic[1] : normalized;
}

/** 提取包装类泛型参数，如 Response<Foo> → Foo */
export function extractWrapperGenericType(returnType: string): string | undefined {
  const match = returnType.trim().match(/^(\w+)\s*<(.+)>\s*$/);
  return match ? match[2].trim() : undefined;
}

const COMMON_WRAPPER_NAMES = new Set(['Response', 'Result', 'R', 'ApiResponse', 'CommonResult', 'BaseResponse']);

/** 判断是否为统一响应包装类（基于 DTO 扫描结果与方法体写法） */
export function isWrapperReturnType(
  returnType: string,
  dtoSchemas: DtoSchemaMap = {},
  methodContent?: string,
): boolean {
  const base = extractBaseTypeName(returnType);
  if (!dtoSchemas[base]) return false;

  if (/^(\w+)\s*<.+>$/.test(returnType.trim())) return true;

  if (methodContent) {
    const clean = methodContent;
    if (new RegExp(`\\b${base}\\.builder\\s*\\(`).test(clean)) return true;
    if (new RegExp(`\\b${base}\\.(suc|success|ok|fail|error)\\s*\\(`).test(clean)) return true;
  }

  return COMMON_WRAPPER_NAMES.has(base);
}

/** 定位包装类中类型为 T 的泛型承载字段 */
export function findGenericPayloadFieldName(wrapperFields: DtoFieldMap): string | undefined {
  for (const [name, type] of Object.entries(wrapperFields)) {
    if (type === 'T') return name;
  }
  return undefined;
}

export function extractBalancedArgument(source: string, openParenIndex: number): string | undefined {
  let depth = 1;
  let i = openParenIndex + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    i++;
  }
  if (depth !== 0) return undefined;
  return source.slice(openParenIndex + 1, i - 1);
}

/** builder 链中，参数含方法调用/构造的 setter 视为业务载荷字段 */
export function isLikelyPayloadExpression(expr: string): boolean {
  const t = expr.trim();
  if (!t || t === 'null') return false;
  if (/\([^)]*\)/.test(t)) return true;
  return /^new\s+\w+/.test(t);
}

export function extractBuilderPayloadInfo(
  methodContent: string,
  wrapperType: string,
): { fieldName: string; expr: string } | undefined {
  const clean = methodContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  const builderPattern = new RegExp(`\\b${wrapperType}\\.builder\\s*\\(\\s*\\)`);
  const builderIndex = clean.search(builderPattern);
  if (builderIndex === -1) return undefined;

  const afterBuilder = clean.slice(builderIndex);
  const buildMatch = afterBuilder.match(/\.build\s*\(\s*\)/);
  if (!buildMatch || buildMatch.index === undefined) return undefined;

  const chain = afterBuilder.slice(0, buildMatch.index);
  const fieldPattern = /\.(\w+)\s*\(/g;
  let match;
  let lastPayload: { fieldName: string; expr: string } | undefined;

  while ((match = fieldPattern.exec(chain)) !== null) {
    const fieldName = match[1];
    if (fieldName === 'builder') continue;

    const openParenIndex = match.index + match[0].length - 1;
    const expr = extractBalancedArgument(chain, openParenIndex);
    if (expr && isLikelyPayloadExpression(expr)) {
      lastPayload = { fieldName, expr: expr.trim() };
    }
  }

  return lastPayload;
}

export function extractStaticFactoryPayload(
  methodContent: string,
  wrapperType: string,
): { expr: string } | undefined {
  const clean = methodContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const match = clean.match(
    new RegExp(`\\b${wrapperType}\\.(suc|success|ok|fail|error)\\s*\\(\\s*([\\s\\S]+?)\\s*\\)`),
  );
  if (!match) return undefined;
  return { expr: match[2].trim() };
}

/** @deprecated 使用 isWrapperReturnType */
export function isResponseReturnType(returnType: string): boolean {
  const base = extractBaseTypeName(returnType);
  return base === 'Response' || /^Response\s*<[^>]+>\s*$/.test(returnType.trim());
}

/** @deprecated 使用 extractWrapperGenericType */
export function extractResponseGenericType(returnType: string): string | undefined {
  return extractWrapperGenericType(returnType);
}
