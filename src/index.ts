#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { configManager } from './config';
import { ApiScanner } from './core/scanner/ApiScanner';
import ApiComparer from './modules/comparer';
import ApiFormatter from './modules/formatter';
import ApifoxSyncer from './modules/syncer';
import { ErrorHandler } from './utils/errorHandler';
import { ConfigValidator } from './utils/configValidator';
import {
  createEmptySyncPlan,
  ensureTempDir,
  getDefaultPlanPath,
  isConfirmedSyncPlan,
  loadSyncPlan,
  syncApisToParam,
  validateSyncPlanForSync,
  writeSyncPlan,
} from './utils/syncPlan';
import {
  branchToTargetBranchId,
  buildBranchListPayload,
  formatBranchLabel,
  formatBranchUserLabel,
  loadProjectBranches,
  normalizePlanBranch,
  parseBranchId,
  parseBranchesConfig,
  resolveTargetBranch,
} from './utils/apifoxBranch';
import { ApiInfo, ApifoxBranch, SyncPlan } from './types';

class ApifoxSync {
  private scanner: ApiScanner;
  private comparer: any;
  private formatter: any;
  private syncer: any;

  constructor() {
    this.scanner = new ApiScanner();
    this.comparer = new ApiComparer();
    this.formatter = new ApiFormatter();
    this.syncer = new ApifoxSyncer();
  }

  private collectGitDiff(sourcePath: string): string {
    try {
      const projectRoot = this.scanner.getGitRoot(sourcePath);
      const childProcess = require('child_process');
      const result = childProcess.spawnSync('git', ['diff'], {
        cwd: projectRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      return `${result.stdout || ''}${result.stderr || ''}`.trim();
    } catch {
      return '';
    }
  }

  private apiToSyncPlanApi(api: ApiInfo): any {
    return {
      method: api.method.toUpperCase(),
      path: api.path,
      controllerClass: api.controller?.replace('.java', ''),
      javaMethodName: api.javaMethodName,
    };
  }

  private writeSyncPlanDraft(
    sourcePath: string,
    detectedApis: ApiInfo[],
    comparerSummary?: string,
  ): void {
    const planPath = getDefaultPlanPath();
    if (isConfirmedSyncPlan(planPath)) {
      console.log('⚠️  检测到已确认的同步计划，本次 scan 将作废旧确认，需重新分析并确认');
    }

    const changedFiles = this.scanner.getChangedFiles();
    const gitDiff = this.collectGitDiff(sourcePath);
    const plan = createEmptySyncPlan(changedFiles, gitDiff);
    plan.scanCandidates = detectedApis.map((api) => this.apiToSyncPlanApi(api));
    plan.analysis.summary =
      comparerSummary ||
      '待 LLM 分析：请根据 git diff 与变更文件，判断哪些 Controller 接口的入参/响应受影响，并填写 syncApis。';
    const jsonPath = writeSyncPlan(plan);
    console.log(`\n📋 变更文档已生成（status: pending，待确认）:`);
    console.log(`  - ${jsonPath}`);
    console.log(`  - ${path.join(process.cwd(), 'temp', 'apifox-sync-plan.md')}`);
    console.log(`\n下一步：执行 workflow 或 branches --json，由 LLM 分析后用户确认再 sync。`);
  }

  /**
   * 解析命令行参数
   */
  parseArgs(): any {
    const args = process.argv.slice(2);
    const parsed: any = {};
    let i = 0;

    while (i < args.length) {
      const arg = args[i];

      if (arg === '--help' || arg === '-h') {
        parsed['help'] = true;
        i++;
        continue;
      }

      if (arg.startsWith('--')) {
        const key = arg.slice(2);
        i++;
        if (i < args.length && !args[i].startsWith('--')) {
          let value = args[i];
          if (key === 'api-path' && value && (value.startsWith('C:') || value.includes('\\'))) {
            value = value.replace(/C:\/Program Files\/Git/, '');
            value = value.replace(/\\/g, '/');
          }
          parsed[key] = value;
          i++;
        } else {
          parsed[key] = true;
        }
      } else {
        i++;
      }
    }

    const config = configManager.readConfig();
    if (config) {
      Object.keys(config).forEach((key) => {
        if (parsed[key] === undefined) {
          parsed[key] = (config as any)[key];
        }
      });
    }

    // 如果提供了 project-name 参数，从 MCP 获取连接信息
    if (parsed['project-name'] && !parsed['apifox-project-id'] && !parsed['apifox-api-key']) {
      const apifoxMCP = require('./mcp/apifox').default;
      const connectionInfo = apifoxMCP.getConnectionInfo(parsed['project-name']);
      if (connectionInfo) {
        parsed['apifox-project-id'] = connectionInfo.projectId;
        parsed['apifox-api-key'] = connectionInfo.apiKey;
        console.log(`使用 MCP 项目 "${parsed['project-name']}" 的连接信息 (ID: ${connectionInfo.projectId})`);
      } else {
        // 如果没有连接到项目，不强制要求连接，继续执行
        console.warn(`项目 "${parsed['project-name']}" 未连接，将只扫描接口变化`);
        parsed['apifox-project-id'] = null;
        parsed['apifox-api-key'] = null;
      }
    }

    return parsed;
  }

  private async resolveSyncTargetBranch(
    args: any,
    plan?: SyncPlan,
    projectId?: string,
    apiKey?: string,
  ): Promise<ApifoxBranch> {
    const configBranches = parseBranchesConfig(args['apifox-branches']);
    const branches = await loadProjectBranches({
      projectId,
      apiKey,
      configBranches,
      forceRefresh: args['refresh-branches'] === true,
    });

    return resolveTargetBranch({
      cliBranchId: parseBranchId(args['apifox-branch-id']),
      cliBranchName: args['apifox-branch-name'],
      configBranchId: parseBranchId(configManager.getConfig('apifox-branch-id')),
      planBranch: plan ? normalizePlanBranch(plan) : undefined,
      branches,
      noBranchPrompt: args['no-branch-prompt'] === true,
    });
  }

  async listBranches(): Promise<void> {
    const args = this.parseArgs();
    const payload = await this.fetchBranchPayload(args);

    if (args.json === true) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log('=== Apifox 项目分支 ===');
    console.log(`默认分支: ${payload.defaultBranch}`);
    console.log('');
    for (const branch of payload.branches) {
      console.log(`- ${formatBranchUserLabel(branch)}`);
    }
    console.log('');
    console.log('确认同步时，请让用户选择分支名称；工具内部会使用对应分支 ID。');
    console.log('如需机器读取，请加 --json');
  }

  private async fetchBranchPayload(args: any): Promise<ReturnType<typeof buildBranchListPayload>> {
    const projectId = args['apifox-project-id'];
    const apiKey = args['apifox-api-key'];

    if (!projectId || !apiKey) {
      throw new Error('请提供 Apifox 项目凭据：--apifox-project-id 与 --apifox-api-key，或已连接的 --project-name');
    }

    const configBranches = parseBranchesConfig(args['apifox-branches']);
    const branches = await loadProjectBranches({
      projectId,
      apiKey,
      configBranches,
      forceRefresh: args['refresh-branches'] === true,
    });
    return buildBranchListPayload(branches);
  }

  private writeWorkflowSummary(branchPayload: ReturnType<typeof buildBranchListPayload>): void {
    ensureTempDir();
    const planPath = getDefaultPlanPath();
    let plan: Partial<SyncPlan> = {};
    if (fs.existsSync(planPath)) {
      plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as SyncPlan;
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      changedFiles: plan.changedFiles || [],
      scanCandidates: plan.scanCandidates || [],
      analysisHint: plan.analysis?.summary || '',
      branches: branchPayload,
      nextSteps: [
        'LLM 分析 gitDiff 与变更文件，填写 syncApis / excludedApis',
        '向用户展示分支名称列表，确认目标分支',
        '更新 apifox-sync-plan.json：userConfirmed=true、targetBranch、confirmedAt',
        '执行 sync --sync-mode incremental',
      ],
    };

    const summaryPath = path.join(process.cwd(), 'temp', 'apifox-workflow-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`\n📦 工作流摘要: ${summaryPath}`);
  }

  /**
   * 一键工作流：scan + 分支列表（不执行 sync）
   */
  async workflow(): Promise<void> {
    console.log('=== Apifox 同步工作流（scan + branches）===\n');
    await this.scan();

    const args = this.parseArgs();
    if (!args['apifox-project-id'] || !args['apifox-api-key']) {
      console.log('\n未配置 Apifox 凭据，跳过分支查询。');
      console.log('=== 工作流完成 ===');
      return;
    }

    console.log('\n=== 分支列表（供确认同步前选择）===\n');
    try {
      const payload = await this.fetchBranchPayload(args);
      console.log(JSON.stringify(payload, null, 2));
      this.writeWorkflowSummary(payload);
    } catch (error) {
      console.warn(`分支查询失败: ${(error as Error).message}`);
    }

    console.log('\n=== 工作流完成 ===');
    console.log('下一步：LLM 分析 temp/apifox-sync-plan.json，用户确认分支与接口后执行 sync。');
  }

  /**
   * 验证参数是否完整
   */
  validateArgs(args: any): void {
    const commands = process.argv.slice(2)[0];

    // 使用 ConfigValidator 验证配置
    const validationErrors = ConfigValidator.validate(args);

    if (validationErrors.length > 0) {
      console.error('参数验证失败:');
      validationErrors.forEach((error) => {
        console.error(`- ${error.message}`);
      });

      if (commands === 'sync') {
        console.log('\nUsage:');
        console.log('  从 Swagger 同步:');
        console.log(
          '    api-sync-to-apifox sync --apifox-project-id <id> --apifox-api-key <key> --source-type swagger --source-path <url>',
        );
        console.log('  从代码同步:');
        console.log(
          '    api-sync-to-apifox sync --apifox-project-id <id> --apifox-api-key <key> --source-type code --source-path <dir> --framework <springboot|nodejs|django>',
        );
        console.log('');
        console.log('Options:');
        console.log('  --trigger-mode <auto|manual> 触发模式 (默认: auto)');
        console.log('  --sync-mode <incremental|full> 同步模式 (默认: incremental)');
        console.log('  --apifox-branch-id <ID>           指定 Apifox 迭代分支 ID');
        console.log('  --apifox-branch-name <名称>       指定 Apifox 分支名称（推荐）');
        console.log('  --no-branch-prompt                跳过交互式分支选择，使用默认主分支');
        console.log('  --apis <METHOD:PATH,...> 指定多个接口同步 (例如: "GET:/api/users,POST:/api/users")');
        console.log('  --api-method <method> --api-path <path> 单独接口同步');
      } else if (commands === 'scan') {
        console.log('\nUsage:');
        console.log('  扫描所有接口:');
        console.log(
          '    api-sync-to-apifox scan --source-type code --source-path <dir> --framework <springboot|nodejs|django> --scan-type all',
        );
        console.log('  只扫描变更接口:');
        console.log(
          '    api-sync-to-apifox scan --source-type code --source-path <dir> --framework <springboot|nodejs|django> --scan-type changed',
        );
        console.log('  扫描文档变更:');
        console.log('    api-sync-to-apifox scan --source-type swagger --source-path <url>');
      }

      process.exit(1);
    }
  }

  /**
   * 扫描命令执行
   */
  async scan(): Promise<void> {
    try {
      console.log('=== 开始接口变化扫描 ===');

      const args = this.parseArgs();
      const {
        'source-type': sourceType,
        'source-path': sourcePath,
        framework: framework,
        'scan-type': scanType,
        'apifox-project-id': projectId,
        'apifox-api-key': apiKey,
      } = args;

      if (projectId && apiKey) {
        const connectionValid = await this.syncer.validateApifoxConnection(projectId, apiKey);
        if (!connectionValid) {
          process.exit(1);
        }
      }

      if (sourceType === 'code') {
        if (scanType === 'changed') {
          await this.scanner.detectCodeChanges(sourcePath);
        }

        const detectedApis = await this.scanner.scanCodeForChanges(sourcePath, framework);
        this.formatter.setDtoSchemas(this.scanner.getDtoSchemas());

        let comparerSummary: string | undefined;

        if (projectId && apiKey) {
          const existingApis = await this.syncer.getApifoxExistingApis(projectId, apiKey);
          this.comparer.compareApiChanges(detectedApis, existingApis, scanType === 'changed');

          const docToCheck = this.formatter.generateApiDocFromCode(detectedApis);
          const unformattedCount = this.formatter.countUnformattedChinese(docToCheck);
          if (unformattedCount > 0) {
            console.log(`\n需要格式化的接口：${unformattedCount}个接口的字段说明需要格式化为中文`);
          }

          const added = this.comparer.scanResults.added.length;
          const updated = this.comparer.scanResults.updated.length;
          const removed = this.comparer.scanResults.removed.length;
          if (added + updated + removed > 0) {
            comparerSummary = `与 Apifox 对比：新增 ${added}，更新 ${updated}，删除 ${removed}`;
            console.log(`\n🚨 ${comparerSummary}`);
          }
        } else {
          if (scanType === 'changed' && this.scanner.getChangedFiles().length > 0) {
            console.log(`变更文件关联的 Controller 接口: ${detectedApis.length} 个`);
            detectedApis.forEach((api) => {
              console.log(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`);
            });
          } else if (scanType === 'all') {
            console.log(`发现接口: ${detectedApis.length}个`);
            detectedApis.forEach((api) => {
              console.log(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`);
            });
          } else if (this.scanner.getChangedFiles().length === 0) {
            console.log(`无代码变更`);
          } else {
            console.log(`变更文件中无直接修改的 Controller，需由 LLM 分析间接影响`);
          }
        }

        this.writeSyncPlanDraft(sourcePath, detectedApis, comparerSummary);
      } else {
        const doc = await this.syncer.getOpenApiDoc(sourcePath);
        const apis = this.syncer.extractApisFromDoc(doc);
        console.log(`发现接口: ${apis.length}个`);
        console.log(`接口详情:`);
        apis.forEach((api: any) => {
          console.log(`  ${api.method.toUpperCase()} ${api.path} - ${api.summary}`);
        });
      }

      console.log('=== 扫描完成 ===');
    } catch (error) {
      console.error('Error: 扫描过程中发生错误');
      console.error((error as any).stack);
      process.exit(1);
    }
  }

  /**
   * 主同步方法
   */
  async sync(): Promise<void> {
    try {
      console.log('=== 开始 Apifox 接口同步 ===');

      const args = this.parseArgs();

      // 检查是否连接到 Apifox 项目
      let connectionValid = false;
      if (args['apifox-project-id'] && args['apifox-api-key']) {
        connectionValid = await this.syncer.validateApifoxConnection(args['apifox-project-id'], args['apifox-api-key']);
        if (!connectionValid) {
          console.warn('Apifox 连接无效，将只扫描接口变化');
        }
      } else {
        console.warn('未提供 Apifox 项目信息，将只扫描接口变化');
      }

      if (args['trigger-mode'] === 'manual') {
        console.log('启用手动触发同步模式');
      }

      const {
        'apifox-project-id': projectId,
        'apifox-api-key': apiKey,
        'source-type': sourceType,
        'source-path': sourcePath,
        framework: framework,
        'sync-mode': syncMode,
        'api-path': apiPath,
        'api-method': apiMethod,
        apis: apisParam,
        'sync-plan': syncPlanPath,
      } = args;

      let openApiDoc: any;
      let confirmedPlan: SyncPlan | undefined;

      if (sourceType === 'code') {
        if (apisParam) {
          console.log(`启用多接口同步模式: ${apisParam}`);
          this.scanner.clearChangedFiles();
          openApiDoc = await this.generateMultipleApisDoc(sourcePath, framework, apisParam);
          if (!openApiDoc) {
            console.log('未找到任何指定的接口');
            return;
          }
        } else if (apiPath && apiMethod) {
          console.log(`启用单独接口同步模式: ${apiMethod.toUpperCase()} ${apiPath}`);
          this.scanner.clearChangedFiles();
          openApiDoc = await this.generateSingleApiDoc(sourcePath, framework, apiMethod, apiPath);
          if (!openApiDoc) {
            console.log('未找到指定的接口');
            return;
          }
        } else if (syncMode === 'incremental') {
          const planFile = syncPlanPath || getDefaultPlanPath();
          console.log(`从同步计划加载接口: ${planFile}`);
          const plan = loadSyncPlan(planFile);
          validateSyncPlanForSync(plan);
          confirmedPlan = plan;

          console.log(`已确认同步 ${plan.syncApis.length} 个接口（确认时间: ${plan.confirmedAt || '未知'}）`);
          plan.syncApis.forEach((api) => {
            console.log(`  ${api.method.toUpperCase()} ${api.path}`);
          });

          this.scanner.scopeToPlanChangedFiles(plan.changedFiles);
          const apisFromPlan = syncApisToParam(plan.syncApis);
          openApiDoc = await this.generateMultipleApisDoc(sourcePath, framework, apisFromPlan);
          if (!openApiDoc) {
            console.log('同步计划中的接口在代码中未找到');
            return;
          }

          const formattedDoc = this.formatter.formatOpenApiDoc(openApiDoc);
          this.syncer.saveDocToFile(formattedDoc, 'formatted-api-doc.json');
          const targetBranch = await this.resolveSyncTargetBranch(args, confirmedPlan, projectId, apiKey);
          await this.performSync(formattedDoc, projectId, apiKey, syncMode, [], [], targetBranch);
          return;
        } else {
          console.log('启用全量更新模式');
          this.scanner.clearChangedFiles();
          const detectedApis = await this.scanner.scanCodeForChanges(sourcePath, framework);
          this.formatter.setDtoSchemas(this.scanner.getDtoSchemas());
          openApiDoc = this.formatter.generateApiDocFromCode(detectedApis);
        }
      } else {
        const originalDoc = await this.syncer.getOpenApiDoc(sourcePath);
        openApiDoc = this.formatter.formatOpenApiDoc(originalDoc);
      }

      const formattedDoc = this.formatter.formatOpenApiDoc(openApiDoc);
      this.syncer.saveDocToFile(formattedDoc, 'formatted-api-doc.json');

      const targetBranch = await this.resolveSyncTargetBranch(args, confirmedPlan, projectId, apiKey);
      await this.performSync(formattedDoc, projectId, apiKey, syncMode, [], [], targetBranch);
    } catch (error) {
      console.error('\nError: 同步过程中发生意外错误');
      console.error((error as any).stack);
      process.exit(1);
    }
  }

  /**
   * 生成单个接口的文档
   */
  async generateSingleApiDoc(sourcePath: string, framework: string, method: string, apiPath: string): Promise<any> {
    const detectedApis = await this.scanner.scanCodeForChanges(sourcePath, framework);
    this.formatter.setDtoSchemas(this.scanner.getDtoSchemas());

    const targetApi = detectedApis.find(
      (api) =>
        api.method.toLowerCase() === method.toLowerCase() &&
        (api.path === apiPath || api.path === apiPath + '/' || api.path === apiPath.replace(/\/$/, '')),
    );

    if (!targetApi) {
      return null;
    }

    return this.formatter.generateApiDocFromCode([targetApi]);
  }

  /**
   * 生成多个指定接口的文档
   * @param {string} sourcePath - 源代码路径
   * @param {string} framework - 框架类型
   * @param {string} apisParam - 接口列表，格式: "GET:/api/users,POST:/api/orders"
   */
  async generateMultipleApisDoc(sourcePath: string, framework: string, apisParam: string): Promise<any> {
    const detectedApis = await this.scanner.scanCodeForChanges(sourcePath, framework);
    this.formatter.setDtoSchemas(this.scanner.getDtoSchemas());

    const apiList = apisParam
      .split(',')
      .map((item) => {
        const parts = item.trim().split(':');
        if (parts.length < 2) return null;
        return { method: parts[0].trim(), path: parts.slice(1).join(':').trim() };
      })
      .filter(Boolean);

    if (apiList.length === 0) {
      console.log('无效的接口列表格式，正确格式: "GET:/api/users,POST:/api/orders"');
      return null;
    }

    const targetApis: any[] = [];
    const notFound: string[] = [];

    for (const apiSpec of apiList as any[]) {
      const matched = detectedApis.find(
        (api) =>
          api.method.toLowerCase() === apiSpec.method.toLowerCase() &&
          (api.path === apiSpec.path ||
            api.path === apiSpec.path + '/' ||
            api.path === apiSpec.path.replace(/\/$/, '')),
      );

      if (matched) {
        targetApis.push(matched);
      } else {
        notFound.push(`${apiSpec.method.toUpperCase()} ${apiSpec.path}`);
      }
    }

    if (notFound.length > 0) {
      console.log(`以下接口未找到: ${notFound.join(', ')}`);
    }

    if (targetApis.length === 0) {
      return null;
    }

    console.log(`找到 ${targetApis.length} 个指定接口:`);
    targetApis.forEach((api) => {
      console.log(`  ${api.method.toUpperCase()} ${api.path}`);
    });

    return this.formatter.generateApiDocFromCode(targetApis);
  }

  /**
   * 执行实际同步操作
   */
  async performSync(
    formattedDoc: any,
    projectId: string,
    apiKey: string,
    syncMode: string,
    detectedApis: any[] = [],
    existingApis: any[] = [],
    targetBranch?: ApifoxBranch,
  ): Promise<void> {
    try {
      // 如果连接到 Apifox 项目，同步接口
      if (projectId && apiKey) {
        const targetBranchId = targetBranch ? branchToTargetBranchId(targetBranch) : undefined;
        await this.syncer.syncToApifox(formattedDoc, projectId, apiKey, undefined, {
          targetBranchId,
          targetBranchName: targetBranch ? formatBranchUserLabel(targetBranch) : undefined,
        });

        console.log('\n=== 同步完成 ===');
        console.log('✅ 后端接口已成功同步到 Apifox');
        if (targetBranch) {
          console.log(`✅ 目标分支: ${formatBranchUserLabel(targetBranch)}`);
        }
        console.log('✅ 所有字段说明已格式化为中文');

        if (
          syncMode === 'incremental' &&
          Object.keys(this.comparer.scanResults).length > 0 &&
          (this.comparer.scanResults.added.length > 0 ||
            this.comparer.scanResults.updated.length > 0 ||
            this.comparer.scanResults.removed.length > 0)
        ) {
          this.comparer.outputChangeDetails(detectedApis, existingApis);
        } else if (syncMode === 'full') {
          console.log('全量更新模式：所有接口已同步');
        }
      } else {
        // 如果没有连接到 Apifox 项目，只格式化接口文档
        console.log('\n=== 接口文档已格式化 ===');
        console.log('✅ 后端接口文档已成功格式化');
        console.log('✅ 所有字段说明已格式化为中文');
        console.log('❌ 未连接到 Apifox 项目，无法同步接口');
        console.log('请使用 mcp connect 命令连接到 Apifox 项目后再次执行同步命令');
      }
    } catch (error) {
      console.error('\nError: 同步过程中发生意外错误');
      console.error((error as any).stack);
      process.exit(1);
    }
  }
}

/**
 * 主入口函数
 */
async function main(): Promise<void> {
  const command = process.argv.slice(2)[0];
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    try {
      const helpContent = fs.readFileSync(path.join(__dirname, '../help.txt'), 'utf8');
      console.log(helpContent);
    } catch (_error) {
      console.log('=== Apifox 同步技能帮助 ===');
      console.log('');
      console.log('可用命令：');
      console.log('');
      console.log('api-sync-to-apifox config [action]');
      console.log('  管理配置文件');
      console.log('');
      console.log('api-sync-to-apifox scan [参数]');
      console.log('  扫描后端接口变更（不执行同步）');
      console.log('');
      console.log('api-sync-to-apifox sync [参数]');
      console.log('  同步后端接口到 Apifox');
      console.log('');
      console.log('api-sync-to-apifox help');
      console.log('  显示详细帮助信息');
    }
    return;
  }

  const syncInstance = new ApifoxSync();

  if (command === 'mcp') {
    const { spawn } = require('child_process');
    const mcpServerPath = path.join(__dirname, 'mcp', 'mcp-server.js');
    const mcpArgs = process.argv.slice(3);
    const mcpProcess = spawn('node', [mcpServerPath, ...mcpArgs], {
      stdio: 'inherit',
      shell: true,
    });

    mcpProcess.on('close', (code: number) => {
      console.log(`MCP 控制台已退出，代码: ${code}`);
    });

    return;
  }

  if (command === 'config') {
    const configArgs = process.argv.slice(3);

    if (configArgs.length > 0 && configArgs[0] === 'init') {
      // Parse init-specific args
      const initArgs: any = {};
      for (let i = 1; i < configArgs.length; i++) {
        if (configArgs[i].startsWith('--') && i + 1 < configArgs.length && !configArgs[i + 1].startsWith('--')) {
          initArgs[configArgs[i].slice(2)] = configArgs[i + 1];
          i++;
        }
      }

      // Read credentials to auto-populate project info
      const apifoxMCP = require('./mcp/apifox').default;
      const connectedProjects = apifoxMCP.getConnectedProjects();

      if (connectedProjects.length > 0) {
        // Prefer the project already configured in .apifoxsync.json
        const existingProjectName = configManager.getConfig('project-name') as string | undefined;
        const projectName =
          existingProjectName && connectedProjects.includes(existingProjectName)
            ? existingProjectName
            : connectedProjects[0];
        const connectionInfo = apifoxMCP.getConnectionInfo(projectName);
        initArgs['project-name'] = projectName;
        initArgs['apifox-project-id'] = connectionInfo.projectId;
        initArgs['apifox-api-key'] = connectionInfo.apiKey;
        console.log(`已从凭据中加载项目 "${projectName}" 的连接信息`);
      } else {
        console.warn(
          '未检测到 MCP 连接信息，请先执行 `node dist/index.js mcp connect <项目名> <项目ID> <API密钥>` 连接 Apifox 项目',
        );
        console.warn('配置文件将使用默认值生成，apifox-project-id 和 apifox-api-key 为空');
      }

      // Generate default config and merge: existing config < defaults < init args
      // This preserves user-set values like source-path while filling in defaults for missing fields
      const defaultConfig = ConfigValidator.generateDefaultConfig();
      const existingConfig = configManager.getAllConfig();
      const mergedConfig = { ...defaultConfig, ...existingConfig, ...initArgs };
      configManager.setConfig('apifox-project-id', mergedConfig['apifox-project-id']);
      configManager.setConfig('apifox-api-key', mergedConfig['apifox-api-key']);
      if (mergedConfig['project-name']) configManager.setConfig('project-name', mergedConfig['project-name']);
      if (mergedConfig['source-type']) configManager.setConfig('source-type', mergedConfig['source-type']);
      if (mergedConfig['source-path']) configManager.setConfig('source-path', mergedConfig['source-path']);
      if (mergedConfig['framework']) configManager.setConfig('framework', mergedConfig['framework']);
      if (mergedConfig['sync-mode']) configManager.setConfig('sync-mode', mergedConfig['sync-mode']);
      if (mergedConfig['scan-type']) configManager.setConfig('scan-type', mergedConfig['scan-type']);
      if (mergedConfig['trigger-mode']) configManager.setConfig('trigger-mode', mergedConfig['trigger-mode']);
      configManager.saveConfig();
      console.log(`配置文件已更新: ${path.join(process.cwd(), '.apifoxsync.json')}`);
    } else {
      console.log('=== Apifox 同步技能配置 ===');
      console.log('');
      console.log('配置文件管理命令：');
      console.log('');
      console.log('api-sync-to-apifox config init');
      console.log('  初始化配置文件，创建默认配置');
      console.log('');
      console.log('配置文件格式：');
      console.log('  在项目根目录创建 .apifoxsync.json 文件');
      console.log('');
      console.log('示例配置：');
      console.log(`  {`);
      console.log(`    "apifox-project-id": "12345",`);
      console.log(`    "apifox-api-key": "abc123456",`);
      console.log(`    "source-type": "code",`);
      console.log(`    "source-path": "./src",`);
      console.log(`    "framework": "springboot",`);
      console.log(`    "trigger-mode": "auto",`);
      console.log(`    "sync-mode": "incremental",`);
      console.log(`    "scan-type": "changed"`);
      console.log(`  }`);
    }
  } else if (command === 'scan') {
    await syncInstance.scan();
  } else if (command === 'branches') {
    try {
      await syncInstance.listBranches();
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  } else if (command === 'workflow') {
    await syncInstance.workflow();
  } else if (command === 'sync') {
    await syncInstance.sync();
  } else if (command === 'help' || command === '--help' || command === '-h') {
    try {
      const helpContent = fs.readFileSync(path.join(__dirname, '../help.txt'), 'utf8');
      console.log(helpContent);
    } catch (_error) {
      console.log('=== Apifox 同步技能帮助 ===');
      console.log('');
      console.log('可用命令：');
      console.log('');
      console.log('api-sync-to-apifox config [action]');
      console.log('  管理配置文件');
      console.log('');
      console.log('api-sync-to-apifox scan [参数]');
      console.log('  扫描后端接口变更（不执行同步）');
      console.log('');
      console.log('api-sync-to-apifox sync [参数]');
      console.log('  同步后端接口到 Apifox');
      console.log('');
      console.log('api-sync-to-apifox help');
      console.log('  显示详细帮助信息');
    }
  } else {
    console.log('=== Apifox 同步技能 ===');
    console.log('');
    console.log('未指定命令，可使用以下命令：');
    console.log('');
    console.log('api-sync-to-apifox config init');
    console.log('  初始化配置文件');
    console.log('');
    console.log('api-sync-to-apifox scan');
    console.log('  扫描接口变更');
    console.log('');
    console.log('api-sync-to-apifox sync');
    console.log('  同步接口到 Apifox');
    console.log('');
    console.log('api-sync-to-apifox help');
    console.log('  显示详细帮助');
  }
}

// 执行主程序
main().catch((error) => {
  console.error('=== 执行错误 ===');
  ErrorHandler.handleUnexpectedError(error);
  ErrorHandler.logError(error, {
    operation: 'main',
  });
  process.exit(1);
});
