import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ApifoxBranch } from '../../types';

const BRANCH_CACHE_TTL_MS = 30 * 60 * 1000;
const APIFOX_CLI_VERSION = '2.2.4';

interface BranchCacheEntry {
  projectId: string;
  fetchedAt: string;
  branches: ApifoxBranch[];
}

interface ApifoxCliInvocation {
  command: string;
  baseArgs: string[];
  shell: boolean;
}

interface ApifoxCliBranchRecord {
  id: number;
  name: string;
  isMain?: boolean;
  isArchived?: boolean;
  type?: string;
}

interface ApifoxCliBranchListResponse {
  success?: boolean;
  data?: ApifoxCliBranchRecord[];
  error?: { message?: string };
}

function getBranchCachePath(): string {
  return path.join(process.cwd(), 'temp', 'apifox-branches-cache.json');
}

function readBranchCache(projectId: string): ApifoxBranch[] | null {
  const cachePath = getBranchCachePath();
  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const entry = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as BranchCacheEntry;
    if (entry.projectId !== projectId || !Array.isArray(entry.branches)) {
      return null;
    }
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (Number.isNaN(age) || age > BRANCH_CACHE_TTL_MS) {
      return null;
    }
    return entry.branches;
  } catch {
    return null;
  }
}

function writeBranchCache(projectId: string, branches: ApifoxBranch[]): void {
  const cachePath = getBranchCachePath();
  const cacheDir = path.dirname(cachePath);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const entry: BranchCacheEntry = {
    projectId,
    fetchedAt: new Date().toISOString(),
    branches,
  };
  fs.writeFileSync(cachePath, JSON.stringify(entry, null, 2), 'utf8');
}

function resolveApifoxCliInvocation(): ApifoxCliInvocation {
  const searchRoots = [
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..'),
    process.cwd(),
  ];

  for (const root of searchRoots) {
    const cliJs = path.join(root, 'node_modules', 'apifox-cli', 'bin', 'cli.js');
    if (fs.existsSync(cliJs)) {
      return {
        command: process.execPath,
        baseArgs: [cliJs],
        shell: false,
      };
    }
  }

  return {
    command: 'npx',
    baseArgs: ['-y', `apifox-cli@${APIFOX_CLI_VERSION}`],
    shell: process.platform === 'win32',
  };
}

function mapCliBranch(record: ApifoxCliBranchRecord): ApifoxBranch {
  return {
    id: record.id,
    name: record.name,
    isMain: record.isMain === true,
    isArchived: record.isArchived === true,
    type: record.type,
  };
}

function parseCliStdout(stdout: string): ApifoxCliBranchRecord[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('apifox-cli 未返回分支数据');
  }

  const payload = JSON.parse(trimmed) as ApifoxCliBranchListResponse;
  if (!payload.success) {
    throw new Error(payload.error?.message || 'apifox-cli 查询分支失败');
  }
  if (!Array.isArray(payload.data)) {
    throw new Error('apifox-cli 分支数据格式异常');
  }

  return payload.data.filter((item) => item && !item.isArchived);
}

function runApifoxCliBranchList(projectId: string, accessToken: string): ApifoxCliBranchRecord[] {
  const invocation = resolveApifoxCliInvocation();
  const args = [
    ...invocation.baseArgs,
    'branch',
    'list',
    '--project',
    projectId,
    '--type',
    'all',
    '--access-token',
    accessToken,
  ];

  const result = spawnSync(invocation.command, args, {
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    shell: invocation.shell,
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim();
    throw new Error(message || `apifox-cli 退出码 ${result.status}`);
  }

  return parseCliStdout(result.stdout || '');
}

export function fetchProjectBranchesViaCli(
  projectId: string,
  accessToken: string,
  options?: { forceRefresh?: boolean },
): ApifoxBranch[] {
  if (!options?.forceRefresh) {
    const cached = readBranchCache(projectId);
    if (cached && cached.length > 0) {
      console.log(`使用缓存的 Apifox 分支列表（${cached.length} 个，30 分钟内有效）`);
      return cached;
    }
  }

  const invocation = resolveApifoxCliInvocation();
  if (!invocation.baseArgs[0]?.startsWith('-y')) {
    console.log('使用本地 apifox-cli 查询分支');
  } else {
    console.log('本地未安装 apifox-cli，使用 npx 拉取（可在工具目录执行 npm install）');
  }

  const records = runApifoxCliBranchList(projectId, accessToken);
  const branches = records.map(mapCliBranch);
  if (branches.length === 0) {
    throw new Error('当前项目没有可用分支');
  }
  writeBranchCache(projectId, branches);
  return branches;
}

export function getDefaultBranch(branches: ApifoxBranch[]): ApifoxBranch {
  return branches.find((branch) => branch.isMain) || branches[0];
}

export function toPublicBranchView(branch: ApifoxBranch): { name: string; isMain: boolean } {
  return {
    name: branch.name,
    isMain: branch.isMain === true,
  };
}

export function toAgentBranchView(branch: ApifoxBranch): ApifoxBranch {
  return {
    id: branch.id,
    name: branch.name,
    isMain: branch.isMain === true,
    isArchived: branch.isArchived,
    type: branch.type,
  };
}
