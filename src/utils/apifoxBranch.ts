import * as readline from 'readline';
import { ApifoxBranch, SyncPlan } from '../types';
import {
  fetchProjectBranchesViaCli,
  getDefaultBranch,
  toAgentBranchView,
  toPublicBranchView,
} from './apifoxBranchClient';

export const MAIN_BRANCH: ApifoxBranch = { name: 'main', isMain: true };

export function formatBranchLabel(branch: ApifoxBranch, includeId = false): string {
  const mainTag = branch.isMain ? ' [主分支]' : '';
  const idTag = includeId && branch.id !== undefined ? ` (ID: ${branch.id})` : '';
  return `${branch.name}${mainTag}${idTag}`;
}

export function formatBranchUserLabel(branch: ApifoxBranch): string {
  return formatBranchLabel(branch, false);
}

export function parseBranchesConfig(raw: unknown): ApifoxBranch[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const branches: ApifoxBranch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) continue;
    branches.push({
      id: typeof record.id === 'number' ? record.id : undefined,
      name,
      isMain: record.isMain === true,
      isArchived: record.isArchived === true,
      type: typeof record.type === 'string' ? record.type : undefined,
    });
  }

  return branches.filter((branch) => !branch.isArchived);
}

export function findBranchById(branches: ApifoxBranch[], branchId: number): ApifoxBranch | undefined {
  return branches.find((branch) => branch.id === branchId);
}

export function findBranchByName(branches: ApifoxBranch[], branchName: string): ApifoxBranch | undefined {
  const normalized = branchName.trim().toLowerCase();
  if (!normalized) return undefined;

  const exact = branches.find((branch) => branch.name.toLowerCase() === normalized);
  if (exact) return exact;

  const partialMatches = branches.filter((branch) => branch.name.toLowerCase().includes(normalized));
  return partialMatches.length === 1 ? partialMatches[0] : undefined;
}

export function branchToTargetBranchId(branch: ApifoxBranch): number | undefined {
  if (branch.isMain || branch.id === undefined) {
    return undefined;
  }
  return branch.id;
}

export async function loadProjectBranches(options: {
  projectId?: string;
  apiKey?: string;
  configBranches?: ApifoxBranch[];
  forceRefresh?: boolean;
}): Promise<ApifoxBranch[]> {
  const { projectId, apiKey, configBranches = [], forceRefresh = false } = options;

  if (projectId && apiKey) {
    try {
      console.log('正在查询 Apifox 项目分支列表...');
      const remoteBranches = await Promise.resolve(
        fetchProjectBranchesViaCli(projectId, apiKey, { forceRefresh }),
      );
      console.log(`已获取 ${remoteBranches.length} 个分支`);
      return remoteBranches;
    } catch (error) {
      console.warn(`远程查询分支失败: ${(error as Error).message}`);
    }
  }

  if (configBranches.length > 0) {
    console.log(`使用配置文件中的 ${configBranches.length} 个分支`);
    return configBranches;
  }

  console.warn('无法获取远程分支，使用默认主分支');
  return [MAIN_BRANCH];
}

function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptForBranch(branches: ApifoxBranch[]): Promise<ApifoxBranch> {
  const availableBranches = branches.length > 0 ? branches : [MAIN_BRANCH];
  const defaultBranch = getDefaultBranch(availableBranches);

  console.log('\n请选择要同步到的 Apifox 分支（输入分支名称）：');
  availableBranches.forEach((branch) => {
    const defaultMark = branch.name === defaultBranch.name ? ' [默认]' : '';
    console.log(`  - ${formatBranchUserLabel(branch)}${defaultMark}`);
  });

  const answer = await askQuestion(
    `\n输入分支名称（直接回车使用默认主分支 ${defaultBranch.name}）: `,
  );

  if (!answer) {
    console.log(`已选择默认分支: ${formatBranchUserLabel(defaultBranch)}`);
    return defaultBranch;
  }

  const selected = findBranchByName(availableBranches, answer);
  if (selected) {
    console.log(`已选择分支: ${formatBranchUserLabel(selected)}`);
    return selected;
  }

  console.log(`未找到分支 "${answer}"，回退到默认主分支: ${formatBranchUserLabel(defaultBranch)}`);
  return defaultBranch;
}

export interface ResolveBranchOptions {
  cliBranchId?: number;
  cliBranchName?: string;
  configBranchId?: number;
  planBranch?: ApifoxBranch;
  branches: ApifoxBranch[];
  noBranchPrompt?: boolean;
}

export async function resolveTargetBranch(options: ResolveBranchOptions): Promise<ApifoxBranch> {
  const { cliBranchId, cliBranchName, configBranchId, planBranch, branches, noBranchPrompt } = options;
  const availableBranches = branches.length > 0 ? branches : [MAIN_BRANCH];

  if (cliBranchName) {
    const matched = findBranchByName(availableBranches, cliBranchName);
    const resolved = matched || { name: cliBranchName };
    console.log(`使用 CLI 指定分支: ${formatBranchUserLabel(resolved)}`);
    return resolved;
  }

  if (cliBranchId !== undefined) {
    const matched = findBranchById(availableBranches, cliBranchId);
    const resolved = matched || { id: cliBranchId, name: `branch-${cliBranchId}` };
    console.log(`使用 CLI 指定分支: ${formatBranchLabel(resolved, true)}`);
    return resolved;
  }

  if (planBranch) {
    const matched = findBranchByName(availableBranches, planBranch.name) || planBranch;
    console.log(`使用同步计划指定分支: ${formatBranchUserLabel(matched)}`);
    return matched;
  }

  if (configBranchId !== undefined) {
    const matched = findBranchById(availableBranches, configBranchId);
    const resolved = matched || { id: configBranchId, name: `branch-${configBranchId}` };
    console.log(`使用配置文件指定分支: ${formatBranchLabel(resolved, true)}`);
    return resolved;
  }

  if (!noBranchPrompt && process.stdin.isTTY) {
    return promptForBranch(availableBranches);
  }

  const defaultBranch = getDefaultBranch(availableBranches);
  console.log(`未指定 Apifox 分支，使用默认主分支: ${formatBranchUserLabel(defaultBranch)}`);
  return defaultBranch;
}

export function parseBranchId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function normalizePlanBranch(plan: SyncPlan): ApifoxBranch | undefined {
  if (!plan.targetBranch || !plan.targetBranch.name) {
    return undefined;
  }
  return {
    id: plan.targetBranch.id,
    name: plan.targetBranch.name,
    isMain: plan.targetBranch.isMain === true,
    type: plan.targetBranch.type,
  };
}

export function buildBranchListPayload(branches: ApifoxBranch[]): {
  defaultBranch: string;
  branches: Array<{ name: string; isMain: boolean; id?: number; type?: string }>;
} {
  const defaultBranch = getDefaultBranch(branches);
  return {
    defaultBranch: defaultBranch.name,
    branches: branches.map((branch) => ({
      ...toPublicBranchView(branch),
      id: branch.id,
      type: branch.type,
    })),
  };
}

export function buildAgentBranchSelection(branch: ApifoxBranch): ApifoxBranch {
  return toAgentBranchView(branch);
}
