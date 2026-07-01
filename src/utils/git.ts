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

/** 在指定目录执行 git 命令 */
export function runGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
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
