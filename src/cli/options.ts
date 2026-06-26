import { Command } from 'commander';
import { CliArgs } from '../types';

/** 为 scan / sync / workflow 注册通用选项 */
export function addWorkflowOptions(cmd: Command): Command {
  return cmd
    .option('--project-name <name>', 'MCP 已连接的项目名')
    .option('--apifox-project-id <id>', 'Apifox 项目 ID')
    .option('--apifox-api-key <key>', 'Apifox API 密钥')
    .option('--source-type <type>', '数据源：code 或 swagger')
    .option('--source-path <path>', '代码目录或 Swagger 地址')
    .option('--framework <name>', '框架：springboot / nodejs / django')
    .option('--scan-type <type>', '扫描类型：all 或 changed')
    .option('--sync-mode <mode>', '同步模式：incremental 或 full')
    .option('--trigger-mode <mode>', '触发模式：auto 或 manual')
    .option('--api-method <method>', '单独同步：HTTP 方法')
    .option('--api-path <path>', '单独同步：接口路径')
    .option('--apis <list>', '多接口同步，如 GET:/a,POST:/b')
    .option('--sync-plan <path>', '同步计划文件路径')
    .option('--apifox-branch-id <id>', 'Apifox 分支 ID')
    .option('--apifox-branch-name <name>', 'Apifox 分支名称')
    .option('--refresh-branches', '强制刷新分支列表')
    .option('--no-branch-prompt', '跳过分支交互选择')
    .option('--quiet', '减少日志输出')
    .option('--json', 'JSON 格式输出（适用于 branches 等）');
}

export function addBranchOptions(cmd: Command): Command {
  return cmd
    .option('--project-name <name>', 'MCP 已连接的项目名')
    .option('--apifox-project-id <id>', 'Apifox 项目 ID')
    .option('--apifox-api-key <key>', 'Apifox API 密钥')
    .option('--refresh-branches', '强制刷新分支列表')
    .option('--quiet', '减少日志输出')
    .option('--json', 'JSON 格式输出');
}

/** commander opts → CliArgs（kebab-case 键） */
export function commanderOptsToCliArgs(opts: Record<string, unknown>): CliArgs {
  const args: CliArgs = {};

  const map: Array<[keyof CliArgs | string, string]> = [
    ['project-name', 'projectName'],
    ['apifox-project-id', 'apifoxProjectId'],
    ['apifox-api-key', 'apifoxApiKey'],
    ['source-type', 'sourceType'],
    ['source-path', 'sourcePath'],
    ['framework', 'framework'],
    ['scan-type', 'scanType'],
    ['sync-mode', 'syncMode'],
    ['trigger-mode', 'triggerMode'],
    ['api-method', 'apiMethod'],
    ['api-path', 'apiPath'],
    ['apis', 'apis'],
    ['sync-plan', 'syncPlan'],
    ['apifox-branch-id', 'apifoxBranchId'],
    ['apifox-branch-name', 'apifoxBranchName'],
  ];

  for (const [kebab, camel] of map) {
    const value = opts[camel];
    if (value !== undefined && value !== null) {
      (args as Record<string, unknown>)[kebab] = value;
    }
  }

  if (opts.refreshBranches === true) args['refresh-branches'] = true;
  if (opts.branchPrompt === false) args['no-branch-prompt'] = true;
  if (opts.quiet === true) args.quiet = true;
  if (opts.json === true) args.json = true;

  return args;
}
