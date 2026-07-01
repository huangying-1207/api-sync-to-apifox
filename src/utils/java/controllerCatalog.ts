import fs from 'fs';
import path from 'path';
import { sync as globSync } from 'glob';
import { isTestOrNonApiSourceFile } from '../../core/scanner/frameworks';
import { extractClassName, parseAutowiredFields } from './javaMethodIndex';

export interface ControllerCatalogApi {
  method: string;
  path: string;
  javaMethodName?: string;
}

export interface ControllerCatalogEntry {
  controllerClass: string;
  file: string;
  requestMappingPrefix?: string;
  autowiredTypes: string[];
  importedTypes: string[];
  apis: ControllerCatalogApi[];
}

function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function extractClassRequestMappingPrefix(content: string): string | undefined {
  const clean = stripComments(content);
  const match = clean.match(/@RequestMapping\s*\(\s*(\{[^}]*\}|["'][^"']*["']|[^)]+)\)/);
  if (!match) return undefined;

  const raw = match[1].trim();
  const named = raw.match(/(?:value|path)\s*=\s*["']([^"']+)["']/);
  if (named) return normalizePrefix(named[1]);

  const quoted = raw.match(/^["']([^"']+)["']$/);
  if (quoted) return normalizePrefix(quoted[1]);

  if (raw && !raw.includes('=') && !raw.startsWith('{')) return normalizePrefix(raw);
  return undefined;
}

function normalizePrefix(prefix: string): string {
  let normalized = prefix.trim();
  if (normalized && !normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized.endsWith('/') && normalized.length > 1) normalized = normalized.slice(0, -1);
  return normalized;
}

function extractImportedTypes(content: string): string[] {
  const types = new Set<string>();
  for (const match of content.matchAll(/import\s+(?:static\s+)?([\w.]+)\s*;/g)) {
    const fullName = match[1];
    const simpleName = fullName.split('.').pop();
    if (simpleName) types.add(simpleName);
  }
  return [...types];
}

function extractApis(content: string, classPrefix?: string): ControllerCatalogApi[] {
  const apis: ControllerCatalogApi[] = [];
  const clean = stripComments(content);
  const prefix = classPrefix || '';

  const mappingPatterns: Array<{ method: string; regex: RegExp }> = [
    { method: 'get', regex: /@GetMapping\s*\(\s*(\{[^}]*\}|["'][^"']*["']|[^)]+)\)/g },
    { method: 'post', regex: /@PostMapping\s*\(\s*(\{[^}]*\}|["'][^"']*["']|[^)]+)\)/g },
    { method: 'put', regex: /@PutMapping\s*\(\s*(\{[^}]*\}|["'][^"']*["']|[^)]+)\)/g },
    { method: 'delete', regex: /@DeleteMapping\s*\(\s*(\{[^}]*\}|["'][^"']*["']|[^)]+)\)/g },
    { method: 'patch', regex: /@PatchMapping\s*\(\s*(\{[^}]*\}|["'][^"']*["']|[^)]+)\)/g },
  ];

  for (const { method, regex } of mappingPatterns) {
    for (const match of clean.matchAll(regex)) {
      const apiPath = extractFirstPath(match[1]);
      const fullPath = `${prefix}${apiPath}`.replace(/\/+/g, '/') || '/';
      const snippetStart = Math.max(0, match.index! - 200);
      const snippet = clean.slice(snippetStart, match.index);
      const javaMethodName = snippet.match(/public\s+[\w<>,\s\[\].]+\s+(\w+)\s*\(/)?.[1];

      apis.push({
        method,
        path: fullPath,
        javaMethodName,
      });
    }
  }

  return apis;
}

function extractFirstPath(raw: string): string {
  const trimmed = raw.trim();
  const named = trimmed.match(/(?:value|path)\s*=\s*["']([^"']+)["']/);
  if (named) return normalizeApiPath(named[1]);

  const quoted = trimmed.match(/^["']([^"']*)["']$/);
  if (quoted) return normalizeApiPath(quoted[1]);

  if (trimmed.startsWith('{')) {
    const first = trimmed.match(/["']([^"']*)["']/);
    return normalizeApiPath(first?.[1] || '');
  }

  return normalizeApiPath(trimmed);
}

function normalizeApiPath(apiPath: string): string {
  if (!apiPath) return '';
  let normalized = apiPath.trim();
  if (normalized && !normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized.endsWith('/') && normalized.length > 1) normalized = normalized.slice(0, -1);
  return normalized;
}

export function buildControllerCatalog(sourcePath: string): ControllerCatalogEntry[] {
  const controllerFiles = globSync(`${sourcePath.replace(/\\/g, '/')}/**/*Controller.java`);
  const catalog: ControllerCatalogEntry[] = [];

  for (const file of controllerFiles) {
    if (isTestOrNonApiSourceFile(file)) continue;

    const content = fs.readFileSync(file, 'utf8');
    const controllerClass = extractClassName(content);
    if (!controllerClass) continue;

    const requestMappingPrefix = extractClassRequestMappingPrefix(content);
    const autowired = parseAutowiredFields(content);

    catalog.push({
      controllerClass,
      file: path.normalize(file),
      requestMappingPrefix,
      autowiredTypes: [...new Set(Object.values(autowired).map((type) => type.replace(/<.+>/, '').trim()))],
      importedTypes: extractImportedTypes(content),
      apis: extractApis(content, requestMappingPrefix),
    });
  }

  return catalog.sort((a, b) => a.controllerClass.localeCompare(b.controllerClass));
}

export function findControllerFile(catalog: ControllerCatalogEntry[], controllerClass: string): string | undefined {
  const normalized = controllerClass.trim();
  return catalog.find((entry) => entry.controllerClass === normalized)?.file;
}
