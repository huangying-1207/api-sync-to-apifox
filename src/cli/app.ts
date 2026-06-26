import fs from 'fs';
import path from 'path';
import { configManager } from '../config';
import { SyncPipeline } from '../core/pipeline';
import {
  createEmptySyncPlan,
  ensureTempDir,
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
import { ApiInfo, ApifoxBranch, CliArgs, OpenApiDocument, SyncPlan } from '../types';
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

  private apiToSyncPlanApi(api: ApiInfo) {
    return {
      method: api.method.toUpperCase(),
      path: api.path,
      controllerClass: api.controller?.replace('.java', ''),
      javaMethodName: api.javaMethodName,
    };
  }

  private writeSyncPlanDraft(sourcePath: string, detectedApis: ApiInfo[], comparerSummary?: string): void {
    if (isConfirmedSyncPlan(getDefaultPlanPath())) {
      appLog('⚠️  检测到已确认的同步计划，本次 scan 将作废旧确认，需重新分析并确认');
    }

    const plan = createEmptySyncPlan(this.pipeline.scanner.getChangedFiles(), getGitDiff(sourcePath));
    plan.scanCandidates = detectedApis.map((api) => this.apiToSyncPlanApi(api));
    plan.analysis.summary =
      comparerSummary ||
      '待 LLM 分析：请根据 git diff 与变更文件，判断哪些 Controller 接口的入参/响应受影响，并填写 syncApis。';

    const jsonPath = writeSyncPlan(plan);
    appLog(`\n📋 变更文档已生成（status: pending，待确认）:`);
    appLog(`  - ${jsonPath}`);
    appLog(`  - ${path.join(process.cwd(), 'temp', 'apifox-sync-plan.md')}`);
    appLog(`\n下一步：执行 workflow 或 branches --json，由 LLM 分析后用户确认再 sync。`);
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

  private writeWorkflowSummary(branchPayload: ReturnType<typeof buildBranchListPayload>): void {
    ensureTempDir();
    const planPath = getDefaultPlanPath();
    let plan: Partial<SyncPlan> = {};
    if (fs.existsSync(planPath)) {
      plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as SyncPlan;
    }

    const summaryPath = path.join(process.cwd(), 'temp', 'apifox-workflow-summary.json');
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
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
        },
        null,
        2,
      ),
      'utf8',
    );
    appLog(`\n📦 工作流摘要: ${summaryPath}`);
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
    appLog('=== 开始接口变化扫描 ===');

    const sourceType = args['source-type'];
    const sourcePath = args['source-path']!;
    const framework = args.framework!;
    const scanType = args['scan-type'];
    const projectId = args['apifox-project-id'];
    const apiKey = args['apifox-api-key'];

    if (projectId && apiKey) {
      const ok = await this.pipeline.syncer.validateApifoxConnection(projectId, apiKey);
      if (!ok) process.exit(1);
    }

    if (sourceType === 'code') {
      if (scanType === 'changed') await this.pipeline.scanner.detectCodeChanges(sourcePath);

      const detectedApis = await this.pipeline.scanCodeApis(sourcePath, framework);
      let comparerSummary: string | undefined;

      if (projectId && apiKey) {
        const existingApis = await this.pipeline.syncer.getApifoxExistingApis(projectId, apiKey);
        this.pipeline.comparer.compareApiChanges(detectedApis, existingApis, scanType === 'changed');

        const unformattedCount = this.pipeline.countUnformattedFromApis(detectedApis);
        if (unformattedCount > 0) {
          appLog(`\n需要格式化的接口：${unformattedCount}个接口的字段说明需要格式化为中文`);
        }

        const { added, updated, removed } = this.pipeline.comparer.scanResults;
        if (added.length + updated.length + removed.length > 0) {
          comparerSummary = `与 Apifox 对比：新增 ${added.length}，更新 ${updated.length}，删除 ${removed.length}`;
          appLog(`\n🚨 ${comparerSummary}`);
        }
      } else {
        this.logDetectedApis(detectedApis, scanType);
      }

      this.writeSyncPlanDraft(sourcePath, detectedApis, comparerSummary);
    } else {
      const doc = await this.pipeline.syncer.getOpenApiDoc(sourcePath);
      const apis = this.pipeline.syncer.extractApisFromDoc(doc);
      appLog(`发现接口: ${apis.length}个\n接口详情:`);
      apis.forEach((api) => appLog(`  ${api.method.toUpperCase()} ${api.path} - ${api.summary}`));
    }

    appLog('=== 扫描完成 ===');
  }

  private logDetectedApis(detectedApis: ApiInfo[], scanType: string | undefined): void {
    const changedFiles = this.pipeline.scanner.getChangedFiles();
    if (scanType === 'changed' && changedFiles.length > 0) {
      appLog(`变更文件关联的 Controller 接口: ${detectedApis.length} 个`);
      detectedApis.forEach((api) => appLog(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`));
    } else if (scanType === 'all') {
      appLog(`发现接口: ${detectedApis.length}个`);
      detectedApis.forEach((api) => appLog(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`));
    } else if (changedFiles.length === 0) {
      appLog('无代码变更');
    } else {
      appLog('变更文件中无直接修改的 Controller，需由 LLM 分析间接影响');
    }
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
      this.writeWorkflowSummary(payload);
    } catch (error) {
      appWarn(`分支查询失败: ${(error as Error).message}`);
    }

    appLog('\n=== 工作流完成 ===');
    appLog('下一步：LLM 分析 temp/apifox-sync-plan.json，用户确认分支与接口后执行 sync。');
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

    if (sourceType === 'code') {
      if (apisParam) {
        appLog(`启用多接口同步模式: ${apisParam}`);
        this.pipeline.scanner.clearChangedFiles();
        const doc = await this.pipeline.generateMultipleApisDoc(sourcePath, framework, apisParam);
        if (!doc) {
          appLog('未找到任何指定的接口');
          return;
        }
        formattedDoc = doc;
      } else if (apiPath && apiMethod) {
        appLog(`启用单独接口同步模式: ${apiMethod.toUpperCase()} ${apiPath}`);
        this.pipeline.scanner.clearChangedFiles();
        const doc = await this.pipeline.generateSingleApiDoc(sourcePath, framework, apiMethod, apiPath);
        if (!doc) {
          appLog('未找到指定的接口');
          return;
        }
        formattedDoc = doc;
      } else if (syncMode === 'incremental') {
        const planFile = syncPlanPath || getDefaultPlanPath();
        appLog(`从同步计划加载接口: ${planFile}`);
        const plan = loadSyncPlan(planFile);
        validateSyncPlanForSync(plan);
        confirmedPlan = plan;

        appLog(`已确认同步 ${plan.syncApis.length} 个接口（确认时间: ${plan.confirmedAt || '未知'}）`);
        plan.syncApis.forEach((api) => appLog(`  ${api.method.toUpperCase()} ${api.path}`));

        this.pipeline.scanner.scopeToPlanChangedFiles(plan.changedFiles);
        const doc = await this.pipeline.generateMultipleApisDoc(sourcePath, framework, syncApisToParam(plan.syncApis));
        if (!doc) {
          appLog('同步计划中的接口在代码中未找到');
          return;
        }
        formattedDoc = doc;

        this.pipeline.syncer.saveDocToFile(formattedDoc, 'formatted-api-doc.json');
        await this.performSync(
          formattedDoc,
          projectId,
          apiKey,
          syncMode,
          await this.resolveSyncTargetBranch(args, confirmedPlan, projectId, apiKey),
        );
        return;
      } else {
        appLog('启用全量更新模式');
        this.pipeline.scanner.clearChangedFiles();
        const detectedApis = await this.pipeline.scanCodeApis(sourcePath, framework);
        formattedDoc = this.pipeline.generateFormattedDocFromApis(detectedApis).doc;
      }
    } else {
      const originalDoc = await this.pipeline.syncer.getOpenApiDoc(sourcePath);
      formattedDoc = this.pipeline.formatter.formatOpenApiDoc(originalDoc).doc;
    }

    this.pipeline.syncer.saveDocToFile(formattedDoc, 'formatted-api-doc.json');
    await this.performSync(
      formattedDoc,
      projectId,
      apiKey,
      syncMode,
      await this.resolveSyncTargetBranch(args, confirmedPlan, projectId, apiKey),
    );
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
