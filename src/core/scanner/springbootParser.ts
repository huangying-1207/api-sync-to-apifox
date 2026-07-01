import fs from 'fs';
import path from 'path';
import { sync as globSync } from 'glob';
import { ApiInfo } from '../../types';
import { extractResponseFieldNamesFromApi } from '../../utils/openapi/openapiWalk';
import {
  DtoSchemaMap,
  extractBaseTypeName,
  extractBuilderPayloadInfo,
  extractStaticFactoryPayload,
  extractWrapperGenericType,
  findGenericPayloadFieldName,
  isWrapperReturnType,
} from '../../utils/java/responseType';
import { isVoidReturnType, resolveResponseEntityStatusCode } from '../../utils/java/responseStatus';
import { filePathKey, normalizeFilePath } from '../../utils/helper';
import { collectAffectedControllers, JavaProjectIndex, MapFieldSchema } from '../../utils/java/javaMethodIndex';
import { isTestOrNonApiSourceFile } from './frameworks';

const REQUEST_METHOD_TO_HTTP: Record<string, string> = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  DELETE: 'delete',
  PATCH: 'patch',
};

const DEFAULT_REQUEST_MAPPING_METHODS = ['get', 'post', 'put', 'delete', 'patch'];

export interface RequestMappingEndpoint {
  method: string;
  args: string;
  index: number;
  path: string;
}

function normalizeMappingPath(path: string): string {
  let normalized = path.trim();
  if (normalized && !normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized.endsWith('/') && normalized.length > 1) normalized = normalized.slice(0, -1);
  return normalized;
}

/** 从 Mapping 注解参数中解析全部路径（支持 value/path 与多路径数组） */
export function extractPathsFromAnnotation(raw: string): string[] {
  const trimmed = raw.trim();
  const namedMatch = trimmed.match(/(?:value|path)\s*=\s*(\{[^}]*\}|["'][^"']*["'])/);
  if (namedMatch) {
    const pathRaw = namedMatch[1].trim();
    if (pathRaw.startsWith('{')) {
      const paths = [...pathRaw.matchAll(/["']([^"']+)["']/g)].map((match) => normalizeMappingPath(match[1]));
      return paths.length > 0 ? paths : [''];
    }
    return [normalizeMappingPath(pathRaw.replace(/^["']|["']$/g, ''))];
  }

  const arrayMatch = trimmed.match(/^\{(.+)\}$/s);
  if (arrayMatch) {
    const paths = [...arrayMatch[1].matchAll(/["']([^"']+)["']/g)].map((match) => normalizeMappingPath(match[1]));
    return paths.length > 0 ? paths : [''];
  }

  const singleMatch = trimmed.match(/^["']([^"']+)["']$/);
  if (singleMatch) return [normalizeMappingPath(singleMatch[1])];

  if (trimmed && !trimmed.includes('=')) {
    return [normalizeMappingPath(trimmed)];
  }

  return [''];
}

/** 从 @RequestMapping(...) 参数中解析 method（RequestMethod / HttpMethod，含数组） */
export function extractHttpMethodsFromRequestMappingArgs(args: string): string[] {
  const methodAttr = args.match(/method\s*=\s*(\{[^}]+\}|[^,)\s]+)/);
  if (!methodAttr) return [];

  const raw = methodAttr[1].trim();
  const tokens: string[] = raw.startsWith('{')
    ? raw
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : [raw];

  const methods: string[] = [];
  for (const token of tokens) {
    const name = token.replace(/^(?:RequestMethod|HttpMethod)\./, '').trim().toUpperCase();
    const httpMethod = REQUEST_METHOD_TO_HTTP[name];
    if (httpMethod && !methods.includes(httpMethod)) {
      methods.push(httpMethod);
    }
  }
  return methods;
}

/** 判断 @RequestMapping 是否位于类声明前（类级前缀，非接口） */
export function isClassLevelRequestMapping(content: string, matchIndex: number): boolean {
  const window = content.slice(matchIndex, Math.min(content.length, matchIndex + 600));
  const classMatch = window.match(/public\s+(?:abstract\s+)?class\s+\w+/);
  if (!classMatch || classMatch.index === undefined) return false;

  const beforeClass = window.slice(0, classMatch.index);
  const methodBeforeClass = beforeClass.match(/public\s+(?!class\b)[^;{]+?\s+\w+\s*\(/);
  return !methodBeforeClass;
}

function appendRequestMappingEndpoints(
  endpoints: RequestMappingEndpoint[],
  args: string,
  index: number,
  methods: string[],
): void {
  const paths = extractPathsFromAnnotation(args);
  const effectivePaths = paths.some((path) => path !== '') ? paths.filter((path) => path !== '') : [''];

  for (const method of methods) {
    for (const path of effectivePaths) {
      endpoints.push({ method, args, index, path });
    }
  }
}

/** 扫描方法级 @RequestMapping（含无 method 时默认五类 HTTP 方法） */
export function findRequestMappingMethodEndpoints(content: string): RequestMappingEndpoint[] {
  const endpoints: RequestMappingEndpoint[] = [];

  for (const match of content.matchAll(/@RequestMapping\s*\(\s*(\{[^}]*\}|[^)]+)\)/g)) {
    const args = match[1];
    const index = match.index!;
    const explicitMethods = extractHttpMethodsFromRequestMappingArgs(args);

    if (explicitMethods.length > 0) {
      appendRequestMappingEndpoints(endpoints, args, index, explicitMethods);
      continue;
    }

    if (isClassLevelRequestMapping(content, index)) {
      continue;
    }

    const paths = extractPathsFromAnnotation(args).filter((path) => path !== '');
    if (paths.length === 0) continue;

    appendRequestMappingEndpoints(endpoints, args, index, DEFAULT_REQUEST_MAPPING_METHODS);
  }

  return endpoints;
}

/** Spring Boot Controller / DTO 解析逻辑 */
export class SpringBootParser {
  private methodReturnTypes: Record<string, string[]> = {};
  private projectIndex: JavaProjectIndex | null = null;
  extractPathFromAnnotation(raw: string): string {
    const paths = extractPathsFromAnnotation(raw);
    return paths[0] ?? '';
  }

  findMethodEnd(content: string, startIndex: number): number {
    let braceCount = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inComment = false;
    let inLineComment = false;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];

      if (inLineComment) {
        if (char === '\n') inLineComment = false;
        continue;
      }
      if (inComment) {
        if (char === '*' && nextChar === '/') {
          inComment = false;
          i++;
        }
        continue;
      }
      if (inSingleQuote) {
        if (char === '\\' && nextChar) i++;
        else if (char === "'") inSingleQuote = false;
        continue;
      }
      if (inDoubleQuote) {
        if (char === '\\' && nextChar) i++;
        else if (char === '"') inDoubleQuote = false;
        continue;
      }

      if (char === '/' && nextChar === '*') {
        inComment = true;
        i++;
      } else if (char === '/' && nextChar === '/') {
        inLineComment = true;
        i++;
      } else if (char === "'") {
        inSingleQuote = true;
      } else if (char === '"') {
        inDoubleQuote = true;
      } else if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) return i + 1;
      }
    }

    return content.length;
  }

  extractMethodContent(content: string, startIndex: number): string {
    return content.slice(startIndex, this.findMethodEnd(content, startIndex));
  }

  inferGenericTypes(returnType: string, methodContent: string, api: ApiInfo): string {
    if (!returnType) return returnType;

    const genericMatch = returnType.match(/^(List|Set|Collection)<(.+)>$/);
    if (!genericMatch) return returnType;

    const innerType = genericMatch[2];
    if (innerType !== 'Object') return returnType;

    const inferredTypes = new Set<string>();
    const newPattern = /new\s+(\w+)\s*\(/g;
    let newMatch;
    while ((newMatch = newPattern.exec(methodContent)) !== null) {
      const typeName = newMatch[1];
      if (
        ![
          'ArrayList', 'HashMap', 'HashSet', 'LinkedList', 'TreeMap', 'TreeSet',
          'String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Object', 'Date', 'LinkedHashMap',
        ].includes(typeName)
      ) {
        inferredTypes.add(typeName);
      }
    }

    if (inferredTypes.size === 0) {
      const addPattern = /\w+\.add\s*\(\s*(\w+)\s*\)/g;
      let addMatch;
      while ((addMatch = addPattern.exec(methodContent)) !== null) {
        const varName = addMatch[1];
        const varDeclPattern = new RegExp(`(?:@\\w+(?:\\([^)]*\\))?\\s+)?(\\w+(?:<[^>]+>)?)\\s+${varName}\\b`);
        const varDeclMatch = methodContent.match(varDeclPattern);
        if (varDeclMatch) {
          const varType = varDeclMatch[1];
          if (!['String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Object', 'int', 'long', 'double', 'float', 'boolean'].includes(varType)) {
            inferredTypes.add(varType);
          }
        }
      }
    }

    const toJsonPattern = /JSON\.toJSON\s*\(\s*(\w+)\s*\)/;
    const toJsonMatch = methodContent.match(toJsonPattern);
    if (toJsonMatch) {
      const sourceVar = toJsonMatch[1];
      const sourceDeclPattern = new RegExp(`(?:@\\w+(?:\\([^)]*\\))?\\s+)?(\\w+)\\s+${sourceVar}\\b`);
      const sourceDeclMatch = methodContent.match(sourceDeclPattern);
      if (sourceDeclMatch) {
        api.baseType = sourceDeclMatch[1];
        return `${genericMatch[1]}<${sourceDeclMatch[1]}>`;
      }
    }

    if (inferredTypes.size === 1) {
      const actualType = [...inferredTypes][0];
      if ((actualType === 'JSONObject' || actualType.includes('Map')) && toJsonMatch) {
        const sourceVar = toJsonMatch[1];
        const sourceDeclPattern = new RegExp(`(?:@\\w+(?:\\([^)]*\\))?\\s+)?(\\w+)\\s+${sourceVar}\\b`);
        const sourceDeclMatch = methodContent.match(sourceDeclPattern);
        if (sourceDeclMatch) {
          api.baseType = sourceDeclMatch[1];
          return `${genericMatch[1]}<${sourceDeclMatch[1]}>`;
        }
      }
      return `${genericMatch[1]}<${actualType}>`;
    }

    return returnType;
  }

  indexMethodReturnTypes(content: string): void {
    const pattern = /public\s+([\w<>,\s\[\].]+?)\s+(\w+)\s*\(/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const returnType = match[1].trim();
      const methodName = match[2];
      if (['class', 'interface', 'enum', 'if', 'for', 'while', 'switch'].includes(methodName)) continue;

      if (!Object.prototype.hasOwnProperty.call(this.methodReturnTypes, methodName)) {
        this.methodReturnTypes[methodName] = [];
      }
      if (!this.methodReturnTypes[methodName].includes(returnType)) {
        this.methodReturnTypes[methodName].push(returnType);
      }
    }
  }

  pickBestReturnType(candidates: string[]): string {
    const filtered = candidates.filter((type) => type !== 'void' && type !== 'Object');
    return (filtered.length > 0 ? filtered : candidates)[0];
  }

  extractBuilderPayloadField(methodContent: string, wrapperType: string): { fieldName: string; expr: string } | undefined {
    return extractBuilderPayloadInfo(methodContent, wrapperType);
  }

  extractResponseDataExpression(methodContent: string, wrapperType: string = 'Response'): string | undefined {
    const payload = extractBuilderPayloadInfo(methodContent, wrapperType);
    if (payload) return payload.expr;

    const staticPayload = extractStaticFactoryPayload(methodContent, wrapperType);
    return staticPayload?.expr;
  }

  inferResponseDataType(methodContent: string, wrapperType: string = 'Response'): string | undefined {
    const dataExpr = this.extractResponseDataExpression(methodContent, wrapperType);
    if (!dataExpr) return undefined;
    return this.resolveExpressionType(dataExpr, methodContent);
  }

  applyWrapperResponseInfo(api: ApiInfo, methodContent: string, dtoSchemas: DtoSchemaMap): void {
    if (!api.returnType) return;

    const wrapperType = extractBaseTypeName(api.returnType);
    if (!isWrapperReturnType(api.returnType, dtoSchemas, methodContent)) return;

    api.responseWrapperType = wrapperType;

    const builderPayload = extractBuilderPayloadInfo(methodContent, wrapperType);
    if (builderPayload) {
      api.responsePayloadField = builderPayload.fieldName;
      const inferred = this.resolveExpressionType(builderPayload.expr, methodContent);
      if (inferred) api.responseDataType = inferred;
    }

    const staticPayload = extractStaticFactoryPayload(methodContent, wrapperType);
    if (staticPayload) {
      if (!api.responsePayloadField) {
        api.responsePayloadField = findGenericPayloadFieldName(dtoSchemas[wrapperType] || {});
      }
      const inferred = this.resolveExpressionType(staticPayload.expr, methodContent);
      if (inferred) api.responseDataType = inferred;
    }

    const genericType = extractWrapperGenericType(api.returnType);
    if (genericType) {
      api.responseDataType = genericType;
    }

    if (!api.responsePayloadField) {
      api.responsePayloadField = findGenericPayloadFieldName(dtoSchemas[wrapperType] || {});
    }

    const dataType = api.responseDataType;
    if (!dataType) return;

    const mapMatch = dataType.match(/^Map<[^,]+,\s*(.+)>$/);
    if (mapMatch) {
      api.baseType = mapMatch[1].trim();
      return;
    }

    const listMatch = dataType.match(/^(?:List|Set|Collection)<(.+)>$/);
    if (listMatch) {
      api.baseType = listMatch[1].trim();
      return;
    }

    if (dataType !== 'JSONObject') {
      api.baseType = dataType;
    }
  }

  resolveExpressionType(expr: string, methodContent: string): string | undefined {
    if (!expr || expr === 'null') return undefined;

    const methodCallMatch = expr.match(/(?:[\w$]+\.)+(\w+)\s*\(/);
    if (methodCallMatch) {
      const methodName = methodCallMatch[1];
      const candidates = Object.prototype.hasOwnProperty.call(this.methodReturnTypes, methodName)
        ? this.methodReturnTypes[methodName]
        : undefined;
      if (candidates && candidates.length > 0) {
        return candidates.length === 1 ? candidates[0] : this.pickBestReturnType(candidates);
      }
    }

    if (/^\w+$/.test(expr)) {
      const varDecl = methodContent.match(
        new RegExp(`(?:@\\w+(?:\\([^)]*\\))?\\s+)?([\\w<>,\\s\\[\\].]+?)\\s+${expr}\\b`),
      );
      if (varDecl) return varDecl[1].trim();
    }

    return undefined;
  }

  applyResponseDataType(api: ApiInfo, methodContent: string, dtoSchemas: DtoSchemaMap): void {
    this.applyWrapperResponseInfo(api, methodContent, dtoSchemas);
  }

  extractMapFields(methodContent: string, enclosingClassContent?: string): MapFieldSchema {
    const localFields = this.extractPutFieldsFromBody(methodContent);
    if (!enclosingClassContent || !this.projectIndex) {
      return localFields;
    }

    const tracedFields = this.projectIndex.traceMapFields(methodContent, enclosingClassContent);
    return { ...tracedFields, ...localFields };
  }

  private extractPutFieldsFromBody(methodContent: string): MapFieldSchema {
    const fields: Record<string, { type: string; format?: string }> = {};
    let cleanContent = methodContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    const putPattern = /\w+\.put\s*\(\s*"(\w+)"\s*,\s*([^)]+)\s*\)/g;
    let match;
    while ((match = putPattern.exec(cleanContent)) !== null) {
      const fieldName = match[1];
      const valueExpr = match[2].trim();

      if (/^".*"$/.test(valueExpr)) fields[fieldName] = { type: 'string' };
      else if (/^\d+$/.test(valueExpr)) fields[fieldName] = { type: 'integer' };
      else if (/^\d+\.\d+$/.test(valueExpr)) fields[fieldName] = { type: 'number' };
      else if (/^(true|false)$/.test(valueExpr)) fields[fieldName] = { type: 'boolean' };
      else if (/new\s+(java\.util\.)?Date/.test(valueExpr)) fields[fieldName] = { type: 'string', format: 'date-time' };
      else if (/^\d+L$/i.test(valueExpr)) fields[fieldName] = { type: 'integer' };
      else fields[fieldName] = { type: 'string' };
    }

    return fields;
  }

  collectDtoScanScope(sourcePath: string, changedFiles: string[], findGitRoot: (dir: string) => string): string[] | undefined {
    if (changedFiles.length === 0) return undefined;

    const projectRoot = findGitRoot(sourcePath);
    const srcMainJava = path.join(projectRoot, 'src', 'main', 'java');
    const scopedFiles = new Set<string>();

    for (const file of changedFiles) {
      if (file.endsWith('.java') && fs.existsSync(file)) {
        scopedFiles.add(path.normalize(file));
      }
    }

    const dtoPackagePattern = /\.(dto|entity|vo|model|domain)\./i;
    for (const file of changedFiles) {
      if (!/Controller\.java$/i.test(file) || !fs.existsSync(file)) continue;

      const content = fs.readFileSync(file, 'utf8');
      const importMatches = content.matchAll(/import\s+([\w.]+)\s*;/g);
      for (const match of importMatches) {
        const classPath = match[1];
        if (!dtoPackagePattern.test(classPath)) continue;

        const relativeJava = `${classPath.replace(/\./g, path.sep)}.java`;
        for (const candidate of [
          path.join(srcMainJava, relativeJava),
          path.join(projectRoot, relativeJava),
          path.join(sourcePath, relativeJava),
        ]) {
          if (fs.existsSync(candidate)) scopedFiles.add(path.normalize(candidate));
        }
      }
    }

    return [...scopedFiles];
  }

  expandIncrementalControllerFiles(sourcePath: string, changedFiles: string[]): string[] {
    if (!this.projectIndex) {
      this.projectIndex = JavaProjectIndex.build(sourcePath);
    }

    const normalizedChanged = changedFiles
      .filter((file) => file.endsWith('.java') && fs.existsSync(file))
      .map((file) => path.normalize(file));

    const directControllers = normalizedChanged.filter((file) => /Controller\.java$/i.test(file));
    const affectedControllers = collectAffectedControllers(sourcePath, changedFiles, this.projectIndex);
    const files = new Map<string, string>();
    for (const file of [...directControllers, ...affectedControllers]) {
      const canonical = normalizeFilePath(file);
      const key = filePathKey(canonical);
      if (!files.has(key)) {
        files.set(key, canonical);
      }
    }

    if (files.size > 0) {
      return [...files.values()];
    }

    return normalizedChanged.filter((file) => /Controller\.java$/i.test(file));
  }

  scanJavaClasses(
    sourcePath: string,
    scopedFiles: string[] | undefined,
    changedFiles: string[],
    findGitRoot: (dir: string) => string,
  ): Record<string, Record<string, string>> {
    const classSchemas: Record<string, Record<string, string>> = {};
    this.methodReturnTypes = {};
    this.projectIndex = JavaProjectIndex.build(sourcePath);

    try {
      const allJavaFiles = globSync(sourcePath.replace(/\\/g, '/') + '/**/*.java');
      for (const file of allJavaFiles) {
        if (isTestOrNonApiSourceFile(file)) continue;
        this.indexMethodReturnTypes(fs.readFileSync(file, 'utf8'));
      }
    } catch {
      console.warn('方法返回类型索引失败，Response.data 推断可能不完整');
    }

    const dtoScope = scopedFiles ?? this.collectDtoScanScope(sourcePath, changedFiles, findGitRoot);

    try {
      let javaFiles: string[];
      if (dtoScope && dtoScope.length > 0) {
        javaFiles = dtoScope;
        console.log(`DTO 增量扫描：${javaFiles.length} 个相关 Java 文件`);
      } else {
        javaFiles = globSync(sourcePath.replace(/\\/g, '/') + '/**/*.java');
        console.log(`DTO 全量扫描：${javaFiles.length} 个 Java 文件`);
      }

      for (const file of javaFiles) {
        const content = fs.readFileSync(file, 'utf8');
        const className = path.basename(file, '.java');
        if (/@(Controller|RestController|Service|Repository|Component|Configuration|Aspect)\b/.test(content)) {
          continue;
        }

        const fields: Record<string, string> = {};
        const fieldPattern = /private\s+(\w+(?:<[^>]+>)?)\s+(\w+)\s*;/g;
        let fieldMatch;
        while ((fieldMatch = fieldPattern.exec(content)) !== null) {
          fields[fieldMatch[2]] = fieldMatch[1];
        }

        if (Object.keys(fields).length > 0) {
          classSchemas[className] = fields;
        }
      }

      for (const file of javaFiles) {
        const content = fs.readFileSync(file, 'utf8');
        const className = path.basename(file, '.java');
        const fields = classSchemas[className];
        if (!fields) continue;

        const extendsMatch = content.match(/class\s+\w+\s+extends\s+(\w+)/);
        if (extendsMatch) {
          const parentName = extendsMatch[1];
          const parentFields = classSchemas[parentName];
          if (parentFields) {
            classSchemas[className] = { ...parentFields, ...fields };
          }
        }
      }
    } catch {
      console.warn('Java 类文件扫描失败，将使用默认 Schema');
    }

    return classSchemas;
  }

  parseApiDetails(content: string, api: ApiInfo, startIndex: number, dtoSchemas: Record<string, any>): void {
    const methodContent = this.extractMethodContent(content, startIndex);

    for (const match of methodContent.matchAll(/@PathVariable(?:\([^)]*\))?\s*\w+\s*(\w+)/g)) {
      api.parameters?.push({ name: match[1], type: 'path' });
    }

    for (const match of methodContent.matchAll(/@RequestParam(?:\([^)]*\))?\s*\w+\s*(\w+)/g)) {
      api.parameters?.push({ name: match[1], type: 'query' });
    }

    const requestBodyMatch = methodContent.match(/@RequestBody\s+(\w+(?:<[^>]+>)?)\s+(\w+)/);
    if (requestBodyMatch) {
      api.requestBodyType = requestBodyMatch[1];
    }

    const methodSignatureMatch = methodContent.match(/public\s+([\w<>,\[\].\s]+?)\s+(\w+)\s*\(/);
    if (methodSignatureMatch) {
      api.javaMethodName = methodSignatureMatch[2];
      const returnType = methodSignatureMatch[1].trim();

      if (isVoidReturnType(returnType)) {
        api.returnType = 'void';
        api.noResponseBody = true;
        const statusCode = resolveResponseEntityStatusCode(methodContent);
        if (statusCode) {
          api.responseStatusCode = statusCode;
        }
      } else if (returnType.includes('JSONObject') || returnType.includes('Map')) {
        api.returnType = 'JSONObject';
      } else {
        api.returnType = this.inferGenericTypes(returnType, methodContent, api);
      }

      const mapFields = this.extractMapFields(methodContent, content);
      if (Object.keys(mapFields).length > 0) {
        api.mapFields = mapFields;
      } else if (api.returnType === 'JSONObject') {
        api.needsLlmFieldSupplement = true;
      }

      this.applyWrapperResponseInfo(api, methodContent, dtoSchemas);
    }

    api.responseFields = extractResponseFieldNamesFromApi(api, dtoSchemas);
  }
}

export const springBootParser = new SpringBootParser();
