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
  formatBranchUserLabel,
  loadProjectBranches,
  normalizePlanBranch,
  parseBranchId,
  parseBranchesConfig,
  resolveTargetBranch,
} from '../utils/apifox/apifoxBranch';
import { CliArgs } from '../utils/cliArgs';
import { ApiInfo, ApifoxBranch, SyncPlan } from '../types';

/** CLI 业务编排：scan / sync / workflow / branches */
export class ApifoxSyncApp {
  private pipeline = new SyncPipeline();

  private collectGitDiff(sourcePath: string): string {
    try {
      const projectRoot = this.pipeline.scanner.getGitRoot(sourcePath);
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
      console.log('⚠️  检测到已确认的同步计划，本次 scan 将作废旧确认，需重新分析并确认');
    }

    const plan = createEmptySyncPlan(this.pipeline.scanner.getChangedFiles(), this.collectGitDiff(sourcePath));
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
    console.log(`\n📦 工作流摘要: ${summaryPath}`);
  }

  async listBranches(args: CliArgs): Promise<void> {
    const payload = await this.fetchBranchPayload(args);
    if (args.json === true) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log('=== Apifox 项目分支 ===');
    console.log(`默认分支: ${payload.defaultBranch}\n`);
    for (const branch of payload.branches) {
      console.log(`- ${formatBranchUserLabel(branch as ApifoxBranch)}`);
    }
    console.log('\n确认同步时，请让用户选择分支名称；工具内部会使用对应分支 ID。');
    console.log('如需机器读取，请加 --json');
  }

  async scan(args: CliArgs): Promise<void> {
    console.log('=== 开始接口变化扫描 ===');

    const {
      'source-type': sourceType,
      'source-path': sourcePath,
      framework,
      'scan-type': scanType,
      'apifox-project-id': projectId,
      'apifox-api-key': apiKey,
    } = args;

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

        const { unformattedCount } = this.pipeline.generateFormattedDocFromApis(detectedApis);
        if (unformattedCount > 0) {
          console.log(`\n需要格式化的接口：${unformattedCount}个接口的字段说明需要格式化为中文`);
        }

        const { added, updated, removed } = this.pipeline.comparer.scanResults;
        if (added.length + updated.length + removed.length > 0) {
          comparerSummary = `与 Apifox 对比：新增 ${added.length}，更新 ${updated.length}，删除 ${removed.length}`;
          console.log(`\n🚨 ${comparerSummary}`);
        }
      } else {
        this.logDetectedApis(detectedApis, scanType);
      }

      this.writeSyncPlanDraft(sourcePath, detectedApis, comparerSummary);
    } else {
      const doc = await this.pipeline.syncer.getOpenApiDoc(sourcePath);
      const apis = this.pipeline.syncer.extractApisFromDoc(doc);
      console.log(`发现接口: ${apis.length}个\n接口详情:`);
      apis.forEach((api) => console.log(`  ${api.method.toUpperCase()} ${api.path} - ${api.summary}`));
    }

    console.log('=== 扫描完成 ===');
  }

  private logDetectedApis(detectedApis: ApiInfo[], scanType: string | undefined): void {
    const changedFiles = this.pipeline.scanner.getChangedFiles();
    if (scanType === 'changed' && changedFiles.length > 0) {
      console.log(`变更文件关联的 Controller 接口: ${detectedApis.length} 个`);
      detectedApis.forEach((api) => console.log(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`));
    } else if (scanType === 'all') {
      console.log(`发现接口: ${detectedApis.length}个`);
      detectedApis.forEach((api) => console.log(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`));
    } else if (changedFiles.length === 0) {
      console.log('无代码变更');
    } else {
      console.log('变更文件中无直接修改的 Controller，需由 LLM 分析间接影响');
    }
  }

  async workflow(args: CliArgs): Promise<void> {
    console.log('=== Apifox 同步工作流（scan + branches）===\n');
    await this.scan(args);

    if (!args['apifox-project-id'] || !args['apifox-api-key']) {
      console.log('\n未配置 Apifox 凭据，跳过分支查询。\n=== 工作流完成 ===');
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

  async sync(args: CliArgs): Promise<void> {
    console.log('=== 开始 Apifox 接口同步 ===');

    if (args['apifox-project-id'] && args['apifox-api-key']) {
      const ok = await this.pipeline.syncer.validateApifoxConnection(args['apifox-project-id'], args['apifox-api-key']);
      if (!ok) console.warn('Apifox 连接无效，将只扫描接口变化');
    } else {
      console.warn('未提供 Apifox 项目信息，将只扫描接口变化');
    }

    if (args['trigger-mode'] === 'manual') console.log('启用手动触发同步模式');

    const {
      'apifox-project-id': projectId,
      'apifox-api-key': apiKey,
      'source-type': sourceType,
      'source-path': sourcePath,
      framework,
      'sync-mode': syncMode,
      'api-path': apiPath,
      'api-method': apiMethod,
      apis: apisParam,
      'sync-plan': syncPlanPath,
    } = args;

    let formattedDoc: any;
    let confirmedPlan: SyncPlan | undefined;

    if (sourceType === 'code') {
      if (apisParam) {
        console.log(`启用多接口同步模式: ${apisParam}`);
        this.pipeline.scanner.clearChangedFiles();
        formattedDoc = await this.pipeline.generateMultipleApisDoc(sourcePath, framework, apisParam);
        if (!formattedDoc) {
          console.log('未找到任何指定的接口');
          return;
        }
      } else if (apiPath && apiMethod) {
        console.log(`启用单独接口同步模式: ${apiMethod.toUpperCase()} ${apiPath}`);
        this.pipeline.scanner.clearChangedFiles();
        formattedDoc = await this.pipeline.generateSingleApiDoc(sourcePath, framework, apiMethod, apiPath);
        if (!formattedDoc) {
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
        plan.syncApis.forEach((api) => console.log(`  ${api.method.toUpperCase()} ${api.path}`));

        this.pipeline.scanner.scopeToPlanChangedFiles(plan.changedFiles);
        formattedDoc = await this.pipeline.generateMultipleApisDoc(sourcePath, framework, syncApisToParam(plan.syncApis));
        if (!formattedDoc) {
          console.log('同步计划中的接口在代码中未找到');
          return;
        }

        this.pipeline.syncer.saveDocToFile(formattedDoc, 'formatted-api-doc.json');
        await this.performSync(formattedDoc, projectId, apiKey, syncMode, await this.resolveSyncTargetBranch(args, confirmedPlan, projectId, apiKey));
        return;
      } else {
        console.log('启用全量更新模式');
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
    formattedDoc: any,
    projectId: string,
    apiKey: string,
    syncMode: string,
    targetBranch?: ApifoxBranch,
  ): Promise<void> {
    if (projectId && apiKey) {
      await this.pipeline.syncer.syncToApifox(formattedDoc, projectId, apiKey, undefined, {
        targetBranchId: targetBranch ? branchToTargetBranchId(targetBranch) : undefined,
        targetBranchName: targetBranch ? formatBranchUserLabel(targetBranch) : undefined,
      });

      console.log('\n=== 同步完成 ===');
      console.log('✅ 后端接口已成功同步到 Apifox');
      if (targetBranch) console.log(`✅ 目标分支: ${formatBranchUserLabel(targetBranch)}`);
      console.log('✅ 所有字段说明已格式化为中文');
      if (syncMode === 'full') console.log('全量更新模式：所有接口已同步');
    } else {
      console.log('\n=== 接口文档已格式化 ===');
      console.log('✅ 后端接口文档已成功格式化');
      console.log('✅ 所有字段说明已格式化为中文');
      console.log('❌ 未连接到 Apifox 项目，无法同步接口');
      console.log('请使用 mcp connect 命令连接到 Apifox 项目后再次执行同步命令');
    }
  }
}
