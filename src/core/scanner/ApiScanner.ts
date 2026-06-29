/**
 * API 扫描器 — 编排 Git 变更检测与各框架扫描
 */

import fs from 'fs';
import path from 'path';
import { sync as globSync } from 'glob';
import { ApiInfo } from '../../types';
import { ErrorHandler } from '../../utils/errorHandler';
import { findGitRoot, getGitChangedFiles } from '../../utils/git';
import { appLog, appWarn } from '../../utils/logger';
import { FRAMEWORK_CONFIGS, isTestOrNonApiSourceFile } from './frameworks';
import { springBootParser } from './springbootParser';
import { extractControllerFolderMeta } from '../../utils/java/controllerFolder';

export { isTestOrNonApiSourceFile } from './frameworks';

export class ApiScanner {
  private changedFiles: string[] = [];
  private dtoSchemas: Record<string, any> = {};

  getGitRoot(sourcePath: string): string {
    return findGitRoot(sourcePath);
  }

  async detectCodeChanges(sourcePath: string): Promise<string[]> {
    appLog('正在检测代码变更...');

    try {
      const modifiedFiles = getGitChangedFiles(sourcePath, (absolutePath) =>
        Boolean(absolutePath.match(/\.(java|js|py)$/) && !isTestOrNonApiSourceFile(absolutePath)),
      );
      appLog(`检测到 ${modifiedFiles.length} 个文件有变更`);
      this.changedFiles = modifiedFiles;
      return modifiedFiles;
    } catch {
      appWarn('Git 变更检测失败，将扫描所有文件');
      this.changedFiles = [];
      return [];
    }
  }

  async scanCodeByFramework(sourcePath: string, framework: string): Promise<ApiInfo[]> {
    const config = FRAMEWORK_CONFIGS[framework];
    if (!config) {
      const error = ErrorHandler.createCustomError('UNSUPPORTED_FRAMEWORK', `不支持的框架类型: ${framework}`, { framework });
      ErrorHandler.handleValidationError([error]);
      ErrorHandler.logError(error, { framework, operation: 'scanCodeForChanges' });
      throw error;
    }

    console.log(`正在扫描 ${config.name} 项目接口变化: ${sourcePath}`);

    if (framework === 'springboot') {
      const dtoScope = springBootParser.collectDtoScanScope(sourcePath, this.changedFiles, findGitRoot);
      this.dtoSchemas = springBootParser.scanJavaClasses(sourcePath, dtoScope, this.changedFiles, findGitRoot);
    }

    let files: string[];
    if (this.changedFiles.length > 0) {
      console.log('增量同步模式：只扫描变更的文件');
      files = this.changedFiles.filter((file) => config.fileExts.some((ext) => file.endsWith(ext)));
    } else {
      try {
        files = globSync(`${sourcePath}/${config.filePattern}`);
      } catch (error: any) {
        ErrorHandler.handleScanError(error, sourcePath);
        return [];
      }
    }

    console.log(`发现 ${files.length} 个 Controller 文件`);
    const apis: ApiInfo[] = [];

    for (const file of files) {
      if (!fs.existsSync(file)) {
        console.warn(`警告：文件不存在，将跳过: ${file}`);
        continue;
      }

      const rawContent = fs.readFileSync(file, 'utf8');
      const fileName = path.basename(file);
      const content = rawContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
      const controllerFolderMeta = extractControllerFolderMeta(content, fileName);
      const controllerKey = path.resolve(file).replace(/\\/g, '/').toLowerCase();

      let classPathPrefix = '';
      if (config.classPathPattern) {
        const classPathMatch = content.match(/@RequestMapping\s*\(\s*(\{[^}]*\}|[^)]+)\)/);
        if (classPathMatch) {
          classPathPrefix = springBootParser.extractPathFromAnnotation(classPathMatch[1]);
          if (classPathPrefix && !classPathPrefix.startsWith('/')) classPathPrefix = '/' + classPathPrefix;
          if (classPathPrefix.endsWith('/')) classPathPrefix = classPathPrefix.slice(0, -1);
        }
      }

      for (const method of Object.keys(config.methodPatterns)) {
        for (const match of content.matchAll(config.methodPatterns[method])) {
          let apiPath = springBootParser.extractPathFromAnnotation(match[1]);
          if (apiPath && !apiPath.startsWith('/')) apiPath = '/' + apiPath;
          if (apiPath && apiPath.endsWith('/') && apiPath.length > 1) apiPath = apiPath.slice(0, -1);

          const api: ApiInfo = {
            path: (classPathPrefix + apiPath).replace(/\/+/g, '/'),
            method,
            controller: fileName,
            controllerKey,
            controllerClassName: controllerFolderMeta.controllerClassName,
            controllerTag: controllerFolderMeta.controllerTag,
            file,
            parameters: [],
          };

          if (framework === 'springboot') {
            springBootParser.parseApiDetails(content, api, match.index!, this.dtoSchemas);
          }

          apis.push(api);
        }
      }
    }

    console.log(`✅ 扫描完成，发现 ${apis.length} 个接口`);
    return apis;
  }

  async scanCodeForChanges(sourcePath: string, framework: string): Promise<ApiInfo[]> {
    return this.scanCodeByFramework(sourcePath, framework);
  }

  getDtoSchemas(): Record<string, any> {
    return this.dtoSchemas;
  }

  getChangedFiles(): string[] {
    return this.changedFiles;
  }

  clearChangedFiles(): void {
    this.changedFiles = [];
  }

  setChangedFiles(files: string[]): void {
    this.changedFiles = files.map((file) => path.normalize(file)).filter((file) => !isTestOrNonApiSourceFile(file));
  }

  scopeToPlanChangedFiles(changedFiles: string[]): void {
    const controllerFiles = changedFiles.filter(
      (file) => /Controller\.java$/i.test(file) || /Controller\.(js|ts)$/i.test(file),
    );
    this.setChangedFiles(controllerFiles.length > 0 ? controllerFiles : changedFiles);
  }
}

export default ApiScanner;
