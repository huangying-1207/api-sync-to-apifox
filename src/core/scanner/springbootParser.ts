import fs from 'fs';
import path from 'path';
import { sync as globSync } from 'glob';
import { ApiInfo } from '../../types';
import { extractResponseFieldNamesFromApi } from '../../utils/openapi/openapiWalk';
import { isTestOrNonApiSourceFile } from './frameworks';

/** Spring Boot Controller / DTO 解析逻辑 */
export class SpringBootParser {
  extractPathFromAnnotation(raw: string): string {
    raw = raw.trim();

    const namedMatch = raw.match(/(?:value|path)\s*=\s*(\{[^}]*\}|["'][^"']*["'])/);
    if (namedMatch) {
      raw = namedMatch[1].trim();
    }

    const arrayMatch = raw.match(/^\{(.+)\}$/s);
    if (arrayMatch) {
      const inner = arrayMatch[1];
      const firstPath = inner.match(/["']([^"']+)["']/);
      return firstPath ? firstPath[1] : '';
    }

    const singleMatch = raw.match(/^["']([^"']+)["']$/);
    if (singleMatch) return singleMatch[1];
    return raw;
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

  extractMapFields(methodContent: string): Record<string, { type: string; format?: string }> {
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

  scanJavaClasses(
    sourcePath: string,
    scopedFiles: string[] | undefined,
    changedFiles: string[],
    findGitRoot: (dir: string) => string,
  ): Record<string, Record<string, string>> {
    const classSchemas: Record<string, Record<string, string>> = {};
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

      if (returnType.includes('JSONObject') || returnType.includes('Map')) {
        api.returnType = 'JSONObject';
      } else {
        api.returnType = this.inferGenericTypes(returnType, methodContent, api);
      }

      const mapFields = this.extractMapFields(methodContent);
      if (Object.keys(mapFields).length > 0) {
        api.mapFields = mapFields;
      }
    }

    api.responseFields = extractResponseFieldNamesFromApi(api, dtoSchemas);
  }
}

export const springBootParser = new SpringBootParser();
