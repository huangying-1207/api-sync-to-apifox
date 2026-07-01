import fs from 'fs';
import path from 'path';
import { filePathKey, normalizeFilePath } from '../helper';
import { sync as globSync } from 'glob';
import { isTestOrNonApiSourceFile } from '../../core/scanner/frameworks';
import { extractBaseTypeName } from './responseType';

export type MapFieldSchema = Record<string, { type: string; format?: string }>;

export interface JavaMethodRecord {
  className: string;
  methodName: string;
  returnType: string;
  body: string;
  filePath: string;
}

const MAX_TRACE_DEPTH = 6;
const SKIP_CALLEE_NAMES = new Set(['put', 'get', 'set', 'add', 'build', 'toString', 'equals', 'hashCode', 'valueOf']);

function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function findMethodBodyEnd(content: string, startIndex: number): number {
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

export function extractMethodBodyFromClass(classContent: string, methodName: string): string | undefined {
  const clean = stripComments(classContent);
  const pattern = new RegExp(`public\\s+([\\w<>,\\s\\[\\].]+?)\\s+${methodName}\\s*\\([^)]*\\)\\s*(?:throws\\s+[\\w.,\\s]+)?\\s*\\{`);
  const match = pattern.exec(clean);
  if (!match || match.index === undefined) return undefined;

  const bodyStart = clean.indexOf('{', match.index);
  if (bodyStart === -1) return undefined;

  return clean.slice(bodyStart, findMethodBodyEnd(clean, bodyStart));
}

export function extractClassName(content: string): string | undefined {
  const match = content.match(/(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/);
  return match?.[1];
}

export function extractPutFieldsFromBody(methodContent: string): MapFieldSchema {
  const fields: MapFieldSchema = {};
  const cleanContent = stripComments(methodContent);

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

export function parseAutowiredFields(classContent: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const clean = stripComments(classContent);
  const pattern =
    /@(?:Autowired|Resource)\s*(?:\([^)]*\)\s*)?(?:private|protected|public)?\s*([\w<>,\s\[\].]+?)\s+(\w+)\s*;/g;

  let match;
  while ((match = pattern.exec(clean)) !== null) {
    fields[match[2]] = match[1].trim();
  }

  return fields;
}

function mergeMapFields(target: MapFieldSchema, source: MapFieldSchema): void {
  for (const [fieldName, schema] of Object.entries(source)) {
    if (!target[fieldName]) {
      target[fieldName] = schema;
    }
  }
}

function resolveReceiverClass(
  receiver: string,
  methodBody: string,
  enclosingClassContent: string,
): string | undefined {
  const autowired = parseAutowiredFields(enclosingClassContent);
  if (autowired[receiver]) {
    return extractBaseTypeName(autowired[receiver]);
  }

  const declMatch = methodBody.match(
    new RegExp(`(?:@\\w+(?:\\([^)]*\\))?\\s+)?([\\w<>,\\s\\[\\].]+?)\\s+${receiver}\\b`),
  );
  if (declMatch) {
    return extractBaseTypeName(declMatch[1].trim());
  }

  const fieldMatch = stripComments(enclosingClassContent).match(
    new RegExp(`(?:private|protected|public)\\s+([\\w<>,\\s\\[\\].]+?)\\s+${receiver}\\s*;`),
  );
  if (fieldMatch) {
    return extractBaseTypeName(fieldMatch[1].trim());
  }

  return undefined;
}

export class JavaProjectIndex {
  private classContents = new Map<string, string>();
  private classFiles = new Map<string, string>();
  private methods = new Map<string, JavaMethodRecord>();

  static build(sourcePath: string): JavaProjectIndex {
    const index = new JavaProjectIndex();
    index.indexSourcePath(sourcePath);
    return index;
  }

  private indexSourcePath(sourcePath: string): void {
    const javaFiles = globSync(`${sourcePath.replace(/\\/g, '/')}/**/*.java`);
    for (const file of javaFiles) {
      if (isTestOrNonApiSourceFile(file)) continue;

      const content = fs.readFileSync(file, 'utf8');
      const className = extractClassName(content);
      if (!className) continue;

      this.classContents.set(className, content);
      this.classFiles.set(className, path.normalize(file));

      const clean = stripComments(content);
      const pattern = /public\s+([\w<>,\s\[\].]+?)\s+(\w+)\s*\(/g;
      let match;
      while ((match = pattern.exec(clean)) !== null) {
        const returnType = match[1].trim();
        const methodName = match[2];
        if (['class', 'interface', 'enum', 'if', 'for', 'while', 'switch'].includes(methodName)) continue;

        const body = extractMethodBodyFromClass(content, methodName);
        if (!body) continue;

        const key = `${className}.${methodName}`;
        this.methods.set(key, {
          className,
          methodName,
          returnType,
          body,
          filePath: path.normalize(file),
        });
      }
    }
  }

  getClassContent(className: string): string | undefined {
    return this.classContents.get(className);
  }

  getClassFile(className: string): string | undefined {
    return this.classFiles.get(className);
  }

  getMethodRecord(className: string, methodName: string): JavaMethodRecord | undefined {
    return this.methods.get(`${className}.${methodName}`);
  }

  traceMapFields(methodBody: string, enclosingClassContent: string, visited: Set<string> = new Set(), depth = 0): MapFieldSchema {
    const result = extractPutFieldsFromBody(methodBody);
    if (depth >= MAX_TRACE_DEPTH) return result;

    const cleanBody = stripComments(methodBody);
    const enclosingClassName = extractClassName(enclosingClassContent);

    const qualifiedCallPattern = /\b([\w$]+)\.(\w+)\s*\(/g;
    let match;
    while ((match = qualifiedCallPattern.exec(cleanBody)) !== null) {
      const receiver = match[1];
      const methodName = match[2];
      if (SKIP_CALLEE_NAMES.has(methodName)) continue;

      const className = resolveReceiverClass(receiver, methodBody, enclosingClassContent);
      if (!className) continue;

      mergeMapFields(result, this.traceCalleeMethod(className, methodName, visited, depth));
    }

    if (enclosingClassName) {
      const unqualifiedCallPattern = /\b(\w+)\s*\(/g;
      while ((match = unqualifiedCallPattern.exec(cleanBody)) !== null) {
        const methodName = match[1];
        if (SKIP_CALLEE_NAMES.has(methodName)) continue;
        if (/^[A-Z]/.test(methodName)) continue;

        mergeMapFields(result, this.traceCalleeMethod(enclosingClassName, methodName, visited, depth));
      }
    }

    return result;
  }

  private traceCalleeMethod(
    className: string,
    methodName: string,
    visited: Set<string>,
    depth: number,
  ): MapFieldSchema {
    const visitKey = `${className}.${methodName}`;
    if (visited.has(visitKey)) return {};
    visited.add(visitKey);

    const record = this.getMethodRecord(className, methodName);
    if (!record) return {};

    const calleeClassContent = this.getClassContent(className) || '';
    return this.traceMapFields(record.body, calleeClassContent, visited, depth + 1);
  }
}

export function collectAffectedControllers(sourcePath: string, changedFiles: string[], index: JavaProjectIndex): string[] {
  const changedClassNames = new Set<string>();
  for (const file of changedFiles) {
    if (!file.endsWith('.java') || !fs.existsSync(file)) continue;
    const className = extractClassName(fs.readFileSync(file, 'utf8'));
    if (className) changedClassNames.add(className);
  }

  if (changedClassNames.size === 0) return [];

  const controllerFiles = globSync(`${sourcePath.replace(/\\/g, '/')}/**/*Controller.java`);
  const affected = new Map<string, string>();

  for (const controllerFile of controllerFiles) {
    if (isTestOrNonApiSourceFile(controllerFile)) continue;

    const content = fs.readFileSync(controllerFile, 'utf8');
    const controllerClassName = extractClassName(content);
    if (!controllerClassName) continue;

    const addController = (): void => {
      const canonical = normalizeFilePath(controllerFile);
      affected.set(filePathKey(canonical), canonical);
    };

    if (changedClassNames.has(controllerClassName)) {
      addController();
      continue;
    }

    for (const changedClassName of changedClassNames) {
      if (controllerReferencesClass(content, changedClassName)) {
        addController();
        break;
      }
    }
  }

  return [...affected.values()];
}

function controllerReferencesClass(controllerContent: string, className: string): boolean {
  const clean = stripComments(controllerContent);
  const importPattern = new RegExp(`import\\s+[\\w.]*\\.${className}\\s*;`);
  if (importPattern.test(clean)) return true;

  const typePattern = new RegExp(`\\b${className}\\b`);
  if (!typePattern.test(clean)) return false;

  const autowired = parseAutowiredFields(controllerContent);
  for (const fieldType of Object.values(autowired)) {
    if (extractBaseTypeName(fieldType) === className) return true;
  }

  for (const [fieldName, fieldType] of Object.entries(autowired)) {
    if (extractBaseTypeName(fieldType) !== className) continue;
    const callPattern = new RegExp(`\\b${fieldName}\\.\\w+\\s*\\(`);
    if (callPattern.test(clean)) return true;
  }

  return typePattern.test(clean);
}
