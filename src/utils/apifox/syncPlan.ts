import fs from 'fs';
import path from 'path';
import { SyncPlan, SyncPlanApi } from '../../types';
import { formatBranchUserLabel } from './apifoxBranch';
import { collectAllAffectedApis, formatChangedFileLabel } from './planImpact';

const DEFAULT_PLAN_PATH = path.join(process.cwd(), 'temp', 'apifox-sync-plan.json');
const DEFAULT_PLAN_MD_PATH = path.join(process.cwd(), 'temp', 'apifox-sync-plan.md');

function formatLocalTime(isoString: string): string {
  return new Date(isoString).toLocaleString('zh-CN', { hour12: false });
}

function formatChangedFileForMarkdown(file: string): string {
  return formatChangedFileLabel(file);
}

function renderAffectedApiTable(apis: SyncPlanApi[]): string[] {
  if (apis.length === 0) return [];
  const lines = [
    '| 方法 | 路径 | 影响类型 | 变更说明 |',
    '|------|------|----------|----------|',
  ];
  for (const api of apis) {
    lines.push(
      `| ${api.method.toUpperCase()} | ${api.path} | ${api.impactType || '-'} | ${api.changeSummary || '-'} |`,
    );
  }
  return lines;
}

export function getDefaultPlanPath(): string {
  return DEFAULT_PLAN_PATH;
}

export function ensureTempDir(): string {
  const reportDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  return reportDir;
}

export function createEmptySyncPlan(changedFiles: string[], gitDiff: string): SyncPlan {
  return {
    version: 1,
    status: 'pending',
    generatedAt: new Date().toISOString(),
    changedFiles,
    gitDiff,
    analysis: {
      summary: '',
      affectedApis: [],
      excludedApis: [],
    },
    syncApis: [],
    userConfirmed: false,
  };
}

export function loadSyncPlan(planPath?: string): SyncPlan {
  const resolved = planPath || DEFAULT_PLAN_PATH;
  if (!fs.existsSync(resolved)) {
    throw new Error(`未找到同步计划文件: ${resolved}。请先执行 scan 并由 LLM 生成变更文档。`);
  }
  const plan = JSON.parse(fs.readFileSync(resolved, 'utf8')) as SyncPlan;
  if (plan.version !== 1) {
    throw new Error(`不支持的同步计划版本: ${plan.version}`);
  }
  return plan;
}

export function validateSyncPlanForSync(plan: SyncPlan): void {
  if (!plan.userConfirmed || plan.status !== 'confirmed') {
    throw new Error(
      '同步计划尚未经用户确认。请先将 apifox-sync-plan.json 中 userConfirmed 设为 true、status 设为 confirmed，或等待用户明确确认后再同步。',
    );
  }
  if (!plan.syncApis || plan.syncApis.length === 0) {
    throw new Error('同步计划中 syncApis 为空，无可同步接口。');
  }
}

export function writeSyncPlan(plan: SyncPlan, planPath?: string): string {
  ensureTempDir();
  const jsonPath = planPath || DEFAULT_PLAN_PATH;
  const normalized: SyncPlan = {
    ...plan,
    status: plan.status === 'confirmed' ? 'confirmed' : 'pending',
    userConfirmed: plan.userConfirmed === true,
    targetBranch: plan.targetBranch,
    confirmedAt: plan.confirmedAt,
  };
  if (normalized.status !== 'confirmed') {
    normalized.userConfirmed = false;
    normalized.confirmedAt = undefined;
    normalized.targetBranch = undefined;
  }
  fs.writeFileSync(jsonPath, JSON.stringify(normalized, null, 2), 'utf8');
  writeSyncPlanMarkdown(normalized);
  return jsonPath;
}

export function isConfirmedSyncPlan(planPath?: string): boolean {
  const resolved = planPath || DEFAULT_PLAN_PATH;
  if (!fs.existsSync(resolved)) {
    return false;
  }
  try {
    const plan = JSON.parse(fs.readFileSync(resolved, 'utf8')) as SyncPlan;
    return plan.status === 'confirmed' && plan.userConfirmed === true;
  } catch {
    return false;
  }
}

export function writeSyncPlanMarkdown(plan: SyncPlan, mdPath?: string): string {
  ensureTempDir();
  const resolved = mdPath || DEFAULT_PLAN_MD_PATH;
  const lines: string[] = [
    '# Apifox 接口同步变更文档',
    '',
    `> 状态: **${plan.status === 'confirmed' ? '已确认，可同步' : '待确认，不可同步'}**`,
    '',
    `- 生成时间: ${formatLocalTime(plan.generatedAt)}`,
    `- 变更文件数: ${plan.changedFiles.length}`,
    `- 待同步接口数: ${plan.syncApis.length}`,
    '',
  ];

  if (plan.targetBranch) {
    lines.push(`- 目标 Apifox 分支: ${formatBranchUserLabel(plan.targetBranch)}`, '');
  }

  if (plan.changedFiles.length > 0) {
    lines.push('## 变更文件', '');
    for (const file of plan.changedFiles) {
      lines.push(`- ${formatChangedFileForMarkdown(file)}`);
    }
    lines.push('');
  }

  if (plan.analysis.summary) {
    lines.push('## 分析摘要', '', plan.analysis.summary, '');
  }

  const changeSources = plan.analysis.changeSources?.filter(
    (source) =>
      source.changeType ||
      source.changeDetail ||
      source.businessMeaning ||
      (source.excludedApis && source.excludedApis.length > 0),
  );

  if (changeSources && changeSources.length > 0) {
    lines.push('## 变更源分析', '');
    for (const source of changeSources) {
      lines.push(`### ${source.sourceClass}`, '');
      if (source.changeType) {
        lines.push(`**变更类型**: ${source.changeType}`, '');
      }
      if (source.changeDetail) {
        lines.push('**变更详情**:', '```', source.changeDetail, '```', '');
      }
      if (source.businessMeaning) {
        lines.push(`**业务含义**: ${source.businessMeaning}`, '');
      }

      if (source.excludedApis && source.excludedApis.length > 0) {
        lines.push('#### 排除的接口', '', '| 方法 | 路径 | 排除原因 |', '|------|------|----------|');
        for (const api of source.excludedApis) {
          lines.push(`| ${api.method.toUpperCase()} | ${api.path} | ${api.reason} |`);
        }
        lines.push('');
      }
    }
  }

  const affectedApis = collectAllAffectedApis(plan);
  if (affectedApis.length > 0) {
    lines.push('## 确认受影响接口', '');
    lines.push(...renderAffectedApiTable(affectedApis), '');
  }

  if (plan.analysis.excludedApis && plan.analysis.excludedApis.length > 0) {
    lines.push('## 排除的接口', '', '| 方法 | 路径 | 排除原因 |', '|------|------|----------|');
    for (const api of plan.analysis.excludedApis) {
      lines.push(`| ${api.method.toUpperCase()} | ${api.path} | ${api.reason} |`);
    }
    lines.push('');
  }

  if (plan.syncApis.length > 0) {
    lines.push('## 待同步接口', '');
    for (const api of plan.syncApis) {
      lines.push(`- ${api.method.toUpperCase()} ${api.path}`);
    }
    lines.push('');
  } else if (plan.status !== 'confirmed') {
    const alreadyAnalyzed = plan.analysis.summary.length > 0;
    if (alreadyAnalyzed && plan.syncApis.length === 0) {
      lines.push('## 结论', '', '经对比 Apifox 快照，**本次无需同步**，所有接口已与 Apifox 一致。', '');
    } else {
      lines.push(
        '## 下一步',
        '',
        '1. LLM 读 `apifox-sync-plan.json`，根据 `changedSourceFiles`、`controllerSourceFiles`、`apifoxSnapshot` 分析影响面',
        '2. 填写 `syncApis`（哪些接口需要同步）和 `analysis.affectedApis`（影响说明）',
        '3. 如有 JSONObject 响应字段不明确，填写 `fieldSupplements`',
        '4. 用户确认后执行 `sync`',
        '',
      );
    }
  }

  lines.push(
    '## 确认说明',
    '',
    plan.userConfirmed
      ? `- 用户已确认（${plan.confirmedAt || '未记录时间'}）`
      : '- **尚未确认**：请用户审阅后明确回复「确认同步」，并指定 Apifox 目标分支（默认主分支 main）',
    '',
  );

  fs.writeFileSync(resolved, lines.join('\n'), 'utf8');
  return resolved;
}

export function syncApisToParam(syncApis: Array<{ method: string; path: string }>): string {
  return syncApis.map((api) => `${api.method.toUpperCase()}:${api.path}`).join(',');
}
