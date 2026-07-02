import fs from 'fs';
import path from 'path';
import { sync as globSync } from 'glob';
import { spawnSync } from 'child_process';

/** 查找 Git 仓库根目录 */
export function findGitRoot(dir: string): string {
  let current = path.resolve(dir);
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    current = path.dirname(current);
  }
  if (fs.existsSync(path.join(current, '.git'))) return current;
  return dir;
}

/** 在指定目录执行 git 命令（非 0 退出码时抛错） */
export function runGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败: ${(result.stderr || result.stdout || '未知错误').trim()}`);
  }
  return (result.stdout || '').trim();
}

export type GitCompareMode = 'head' | 'worktree';

export interface GitCompareOptions {
  /** 基准引用，如 origin/main、main、v1.0.0 */
  baseRef: string;
  /** 对比前是否 fetch 远程（仅当 baseRef 含 remote 名时有效，如 origin/main） */
  fetch?: boolean;
  /**
   * head：当前分支相对基准的提交差异（baseRef...HEAD，适合 feature 分支对比主干）
   * worktree：工作区相对基准的差异（含未提交改动）
   */
  mode?: GitCompareMode;
}

/** 可选 fetch 远程，确保基准分支引用最新 */
export function fetchGitRef(projectRoot: string, baseRef: string): void {
  const slashIndex = baseRef.indexOf('/');
  if (slashIndex <= 0) return;
  const remote = baseRef.slice(0, slashIndex);
  runGit(['fetch', remote], projectRoot);
}

function buildGitDiffArgs(options: GitCompareOptions): string[] {
  const { baseRef, mode = 'head' } = options;
  if (mode === 'worktree') {
    return ['diff', '--name-only', baseRef];
  }
  return ['diff', '--name-only', `${baseRef}...HEAD`];
}

function buildGitDiffTextArgs(options: GitCompareOptions): string[] {
  const { baseRef, mode = 'head' } = options;
  if (mode === 'worktree') {
    return ['diff', baseRef];
  }
  return ['diff', `${baseRef}...HEAD`];
}

/** 解析变更文件列表（绝对路径），支持相对基准分支对比 */
export function getGitChangedFilesComparedTo(
  sourcePath: string,
  options: GitCompareOptions,
  filter: (absolutePath: string) => boolean,
): string[] {
  const projectRoot = findGitRoot(sourcePath);

  if (options.fetch) {
    try {
      fetchGitRef(projectRoot, options.baseRef);
    } catch (error) {
      throw new Error(`拉取远程分支失败: ${(error as Error).message}`);
    }
  }

  runGit(['rev-parse', '--verify', options.baseRef], projectRoot);

  const nameOnlyOutput = runGit(buildGitDiffArgs(options), projectRoot);
  if (!nameOnlyOutput) return [];

  const modifiedFiles = new Set<string>();
  for (const relativePath of nameOnlyOutput.split('\n').filter((line) => line.trim())) {
    const absolutePath = path.normalize(path.join(projectRoot, relativePath));
    for (const file of expandGitChangedPath(absolutePath, filter)) {
      modifiedFiles.add(file);
    }
  }
  return [...modifiedFiles];
}

/** 获取相对基准分支的 git diff 文本 */
export function getGitDiffComparedTo(sourcePath: string, options: GitCompareOptions): string {
  try {
    const projectRoot = findGitRoot(sourcePath);
    if (options.fetch) {
      try {
        fetchGitRef(projectRoot, options.baseRef);
      } catch {
        // fetch 失败时继续尝试本地已有引用
      }
    }
    runGit(['rev-parse', '--verify', options.baseRef], projectRoot);
    return runGit(buildGitDiffTextArgs(options), projectRoot);
  } catch {
    return '';
  }
}

/** 将 git status 条目展开为具体文件（目录会递归展开） */
function expandGitChangedPath(absolutePath: string, filter: (absolutePath: string) => boolean): string[] {
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  if (fs.statSync(absolutePath).isDirectory()) {
    const pattern = `${absolutePath.replace(/\\/g, '/')}/**/*`;
    try {
      return globSync(pattern, { nodir: true }).map((file) => path.normalize(file)).filter(filter);
    } catch {
      return [];
    }
  }

  return filter(absolutePath) ? [absolutePath] : [];
}

/** 获取 git status --porcelain 中的变更文件（绝对路径） */
export function getGitChangedFiles(
  sourcePath: string,
  filter: (absolutePath: string) => boolean,
): string[] {
  const projectRoot = findGitRoot(sourcePath);
  const gitStatus = runGit(['status', '--porcelain'], projectRoot);
  if (!gitStatus) return [];

  const modifiedFiles = new Set<string>();
  for (const line of gitStatus.split('\n').filter((l) => l.trim())) {
    const parts = line.trim().split(/\s+/);
    const relativePath = parts.slice(1).join(' ');
    const absolutePath = path.normalize(
      relativePath.startsWith('/') ? relativePath : path.join(projectRoot, relativePath),
    );
    for (const file of expandGitChangedPath(absolutePath, filter)) {
      modifiedFiles.add(file);
    }
  }
  return [...modifiedFiles];
}

/** 获取 git diff 文本 */
export function getGitDiff(sourcePath: string): string {
  try {
    return runGit(['diff'], findGitRoot(sourcePath));
  } catch {
    return '';
  }
}
