import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import { configManager } from '../config';
import { SyncPipeline } from '../core/pipeline';
import { isTestOrNonApiSourceFile } from '../core/scanner/frameworks';
import {
  createEmptySyncPlan,
  getDefaultPlanPath,
  isConfirmedSyncPlan,
  loadSyncPlan,
  syncApisToParam,
  validateSyncPlanForSync,
  writeSyncPlan,
} from '../utils/apifox/syncPlan';
import {
  branchToTargetBranchId,
  buildBranchListPayload,
  formatBranchLabel,
  loadProjectBranches,
  normalizePlanBranch,
  parseBranchId,
  parseBranchesConfig,
  resolveTargetBranch,
} from '../utils/apifox/apifoxBranch';
import { ApiInfo, ApifoxBranch, CliArgs, OpenApiDocument, SourceFile, SyncPlan } from '../types';
import { getGitDiff } from '../utils/git';
import { appLog, appWarn, isJsonMode, setLogOptions } from '../utils/logger';

function branchLabel(branch: ApifoxBranch): string {
  return formatBranchLabel(branch, false);
}

/** CLI 业务编排：scan / sync / workflow / branches */
export class ApifoxSyncApp {
  private pipeline = new SyncPipeline();

  private applyLogOptions(args: CliArgs): void {
    setLogOptions({ quiet: args.quiet, json: args.json });
  }

  /** 收集变更的 Java 源文件内容 */
  private collectChangedSourceFiles(changedFiles: string[], baseDir: string): SourceFile[] {
    return changedFiles
      .filter((f) => f.endsWith('.java') && fs.existsSync(f))
      .map((f) => ({
        file: path.relative(baseDir, f).replace(/\\/g, '/'),
        content: fs.readFileSync(f, 'utf8'),
      }));
  }

  /** 收集全量 Controller 源文件内容 */
  private collectControllerSourceFiles(sourcePath: string, baseDir: string): SourceFile[] {
    const pattern = `${sourcePath.replace(/\\/g, '/')}/**/*Controller.java`;
    const files = globSync(pattern);
    return files
      .filter((f) => !isTestOrNonApiSourceFile(f))
      .map((f) => ({
        file: path.relative(baseDir, path.normalize(f)).replace(/\\/g, '/'),
        content: fs.readFileSync(f, 'utf8'),
      }));
  }

  private async resolveSyncTargetBranch(
    args: CliArgs,
    plan?: SyncPlan,
    projectId?: string,
    apiKey?: string,
  ): Promise<ApifoxBranch> {
    const branches = await loadProjectBranches({
      projectId,
      apiKey,
      configBranches: parseBranchesConfig(args['apifox-branches']),
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

  private async fetchBranchPayload(args: CliArgs) {
    const projectId = args['apifox-project-id'];
    const apiKey = args['apifox-api-key'];
    if (!projectId || !apiKey) {
      throw new Error('请提供 Apifox 项目凭据：--apifox-project-id 与 --apifox-api-key，或已连接的 --project-name');
    }

    const branches = await loadProjectBranches({
      projectId,
      apiKey,
      configBranches: parseBranchesConfig(args['apifox-branches']),
      forceRefresh: args['refresh-branches'] === true,
    });
    return buildBranchListPayload(branches);
  }

  async listBranches(args: CliArgs): Promise<void> {
    this.applyLogOptions(args);
    const payload = await this.fetchBranchPayload(args);
    if (isJsonMode()) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    appLog('=== Apifox 项目分支 ===');
    appLog(`默认分支: ${payload.defaultBranch}\n`);
    for (const branch of payload.branches) {
      appLog(`- ${branchLabel(branch as ApifoxBranch)}`);
    }
    appLog('\n确认同步时，请让用户选择分支名称；工具内部会使用对应分支 ID。');
    appLog('如需机器读取，请加 --json');
  }

  async scan(args: CliArgs): Promise<void> {
    this.applyLogOptions(args);
    appLog('=== 开始收集接口变更材料 ===');

    const sourceType = args['source-type'];
    const sourcePath = args['source-path']!;
    const scanType = args['scan-type'];
    const projectId = args['apifox-project-id'];
    const apiKey = args['apifox-api-key'];
    const baseDir = process.cwd();

    if (projectId && apiKey) {
      const ok = await this.pipeline.syncer.validateApifoxConnection(projectId, apiKey);
      if (!ok) process.exit(1);
    }

    if (sourceType === 'code') {
      if (isConfirmedSyncPlan(getDefaultPlanPath())) {
        appLog('⚠️  检测到已确认的同步计划，本次 scan 将作废旧确认，需重新分析并确认');
      }

      // 1. 检测 git 变更文件
      if (scanType === 'changed') {
        await this.pipeline.scanner.detectCodeChanges(sourcePath);
      }
      const changedFiles = this.pipeline.scanner.getChangedFiles();
      appLog(`变更文件: ${changedFiles.length} 个`);

      // 2. 读变更源文件（含 Controller/Service/DTO 等所有 .java 变更文件）
      const changedSourceFiles = this.collectChangedSourceFiles(changedFiles, baseDir);
      appLog(`已读取变更源文件: ${changedSourceFiles.length} 个`);

      // 3. 读全量 Controller 源文件（供 LLM 判断接口定义与调用关系）
      const controllerSourceFiles = this.collectControllerSourceFiles(sourcePath, baseDir);
      appLog(`已读取 Controller 源文件: ${controllerSourceFiles.length} 个`);

      // 4. 获取 Apifox 现有接口 OpenAPI 快照
      let apifoxSnapshot: any = null;
      if (projectId && apiKey) {
        appLog('正在获取 Apifox 现有接口快照...');
        apifoxSnapshot = await this.pipeline.syncer.getApifoxOpenApiJson(projectId, apiKey);
        const pathCount = apifoxSnapshot?.paths ? Object.keys(apifoxSnapshot.paths).length : 0;
        appLog(`Apifox 现有接口: ${pathCount} 个路径`);
      }

      // 5. 构建并写入 plan
      const plan = createEmptySyncPlan(changedFiles, getGitDiff(sourcePath));
      plan.changedSourceFiles = changedSourceFiles;
      plan.controllerSourceFiles = controllerSourceFiles;
      if (apifoxSnapshot) plan.apifoxSnapshot = apifoxSnapshot;

      const jsonPath = writeSyncPlan(plan);
      appLog(`\n📋 材料已收集（status: pending，待 LLM 分析）:`);
      appLog(`  - ${jsonPath}`);
      appLog(`  - ${path.join(baseDir, 'temp', 'apifox-sync-plan.md')}`);
      appLog(`\n下一步：LLM 读 apifox-sync-plan.json，分析影响面后填写 syncApis，用户确认后 sync。`);
    } else {
      const doc = await this.pipeline.syncer.getOpenApiDoc(sourcePath);
      const apis = this.pipeline.syncer.extractApisFromDoc(doc);
      appLog(`发现接口: ${apis.length}个`);
      apis.forEach((api) => appLog(`  ${api.method.toUpperCase()} ${api.path} - ${api.summary}`));
    }

    appLog('=== 收集完成 ===');
  }

  /** 读取现有 plan.json，重新生成 plan.md（LLM 更新 syncApis 后调用） */
  async refreshPlan(args: CliArgs): Promise<void> {
    this.applyLogOptions(args);
    const planPath = args['sync-plan'] || getDefaultPlanPath();
    const plan = loadSyncPlan(planPath);
    const mdPath = writeSyncPlan(plan, planPath);
    appLog(`✅ plan.md 已刷新: ${path.join(process.cwd(), 'temp', 'apifox-sync-plan.md')}`);
    appLog(`待同步接口: ${plan.syncApis.length} 个`);
    plan.syncApis.forEach((api) => appLog(`  ${api.method.toUpperCase()} ${api.path}`));
    if (plan.syncApis.length > 0 && !plan.userConfirmed) {
      appLog('\n接口列表已就绪，等待用户确认后执行 sync。');
    }
    void mdPath;
  }

  async workflow(args: CliArgs): Promise<void> {
    this.applyLogOptions(args);
    appLog('=== Apifox 同步工作流（scan + branches）===\n');
    await this.scan(args);

    if (!args['apifox-project-id'] || !args['apifox-api-key']) {
      appLog('\n未配置 Apifox 凭据，跳过分支查询。\n=== 工作流完成 ===');
      return;
    }

    appLog('\n=== 分支列表（供确认同步前选择）===\n');
    try {
      const payload = await this.fetchBranchPayload(args);
      console.log(JSON.stringify(payload, null, 2));
    } catch (error) {
      appWarn(`分支查询失败: ${(error as Error).message}`);
    }

    appLog('\n=== 工作流完成 ===');
    appLog('下一步：LLM 分析 temp/apifox-sync-plan.json，用户确认分支与接口后执行 sync。');
  }

  private async loadExistingApisForFolderResolution(
    projectId: string | undefined,
    apiKey: string | undefined,
    projectName: string | undefined,
    targetBranch?: ApifoxBranch,
  ): Promise<ApiInfo[]> {
    if (!projectId || !apiKey) return [];

    if (targetBranch && !targetBranch.isMain) {
      appWarn('Apifox export-openapi 暂未提供目标分支参数，本次目录继承使用项目默认导出结果');
    }

    return this.pipeline.syncer.getApifoxExistingApis(projectId, apiKey, projectName, true);
  }

  async sync(args: CliArgs): Promise<void> {
    this.applyLogOptions(args);
    appLog('=== 开始 Apifox 接口同步 ===');

    if (args['apifox-project-id'] && args['apifox-api-key']) {
      const ok = await this.pipeline.syncer.validateApifoxConnection(args['apifox-project-id'], args['apifox-api-key']);
      if (!ok) appWarn('Apifox 连接无效，将只扫描接口变化');
    } else {
      appWarn('未提供 Apifox 项目信息，将只扫描接口变化');
    }

    if (args['trigger-mode'] === 'manual') appLog('启用手动触发同步模式');

    const projectId = args['apifox-project-id'];
    const apiKey = args['apifox-api-key'];
    const sourceType = args['source-type'];
    const sourcePath = args['source-path']!;
    const framework = args.framework!;
    const syncMode = args['sync-mode'] || 'incremental';
    const apiPath = args['api-path'];
    const apiMethod = args['api-method'];
    const apisParam = args.apis;
    const syncPlanPath = args['sync-plan'];

    let formattedDoc: OpenApiDocument;
    let confirmedPlan: SyncPlan | undefined;
    let targetBranch: ApifoxBranch | undefined;

    if (sourceType === 'code') {
      if (!apisParam && !(apiPath && apiMethod) && syncMode === 'incremental') {
        const planFile = syncPlanPath || getDefaultPlanPath();
        appLog(`从同步计划加载接口: ${planFile}`);
        const plan = loadSyncPlan(planFile);
        validateSyncPlanForSync(plan);
        confirmedPlan = plan;

        appLog(`已确认同步 ${plan.syncApis.length} 个接口（确认时间: ${plan.confirmedAt || '未知'}）`);
        plan.syncApis.forEach((api) => appLog(`  ${api.method.toUpperCase()} ${api.path}`));
      }

      if (projectId && apiKey) {
        targetBranch = await this.resolveSyncTargetBranch(args, confirmedPlan, projectId, apiKey);
      }
      const existingApis = await this.loadExistingApisForFolderResolution(
        projectId,
        apiKey,
        args['project-name'],
        targetBranch,
      );

      if (apisParam) {
        appLog(`启用多接口同步模式: ${apisParam}`);
        this.pipeline.scanner.clearChangedFiles();
        const doc = await this.pipeline.generateMultipleApisDoc(sourcePath, framework, apisParam, existingApis);
        if (!doc) {
          appLog('未找到任何指定的接口');
          return;
        }
        formattedDoc = doc;
      } else if (apiPath && apiMethod) {
        appLog(`启用单独接口同步模式: ${apiMethod.toUpperCase()} ${apiPath}`);
        this.pipeline.scanner.clearChangedFiles();
        const doc = await this.pipeline.generateSingleApiDoc(
          sourcePath,
          framework,
          apiMethod,
          apiPath,
          existingApis,
        );
        if (!doc) {
          appLog('未找到指定的接口');
          return;
        }
        formattedDoc = doc;
      } else if (confirmedPlan) {
        this.pipeline.scanner.scopeToPlanChangedFiles(confirmedPlan.changedFiles, sourcePath, framework);
        const detectedApis = await this.pipeline.scanCodeApis(sourcePath, framework);
        const doc = await this.pipeline.generateMultipleApisDoc(
          sourcePath,
          framework,
          syncApisToParam(confirmedPlan.syncApis),
          existingApis,
          detectedApis,
          confirmedPlan,
        );
        if (!doc) {
          appLog('同步计划中的接口在代码中未找到');
          return;
        }
        formattedDoc = doc;
      } else {
        appLog('启用全量更新模式');
        this.pipeline.scanner.clearChangedFiles();
        const detectedApis = await this.pipeline.scanCodeApis(sourcePath, framework);
        this.pipeline.resolveFoldersForApis(detectedApis, { existingApis, allScannedApis: detectedApis });
        formattedDoc = this.pipeline.generateFormattedDocFromApis(detectedApis).doc;
      }
    } else {
      const originalDoc = await this.pipeline.syncer.getOpenApiDoc(sourcePath);
      formattedDoc = this.pipeline.formatter.formatOpenApiDoc(originalDoc).doc;
      if (projectId && apiKey) {
        targetBranch = await this.resolveSyncTargetBranch(args, confirmedPlan, projectId, apiKey);
      }
    }

    if (args['save-doc'] === true) {
      this.pipeline.syncer.saveDocToFile(formattedDoc, 'formatted-api-doc.json');
    }
    await this.performSync(formattedDoc, projectId, apiKey, syncMode, targetBranch);
  }

  private async performSync(
    formattedDoc: OpenApiDocument,
    projectId: string | undefined,
    apiKey: string | undefined,
    syncMode: string,
    targetBranch?: ApifoxBranch,
  ): Promise<void> {
    if (projectId && apiKey) {
      await this.pipeline.syncer.syncToApifox(formattedDoc, projectId, apiKey, undefined, {
        targetBranchId: targetBranch ? branchToTargetBranchId(targetBranch) : undefined,
        targetBranchName: targetBranch ? branchLabel(targetBranch) : undefined,
      });

      appLog('\n=== 同步完成 ===');
      appLog('✅ 后端接口已成功同步到 Apifox');
      if (targetBranch) appLog(`✅ 目标分支: ${branchLabel(targetBranch)}`);
      appLog('✅ 所有字段说明已格式化为中文');
      if (syncMode === 'full') appLog('全量更新模式：所有接口已同步');
    } else {
      appLog('\n=== 接口文档已格式化 ===');
      appLog('✅ 后端接口文档已成功格式化');
      appLog('✅ 所有字段说明已格式化为中文');
      appLog('❌ 未连接到 Apifox 项目，无法同步接口');
      appLog('请使用 mcp connect 命令连接到 Apifox 项目后再次执行 sync');
    }
  }
}
