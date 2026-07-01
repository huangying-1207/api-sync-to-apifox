import path from 'path';
import { spawn } from 'child_process';
import { Command } from 'commander';
import { ErrorHandler } from '../utils/errorHandler';
import { resolveCliArgs, stripCommand, validateCliArgs } from '../utils/cliArgs';
import { ApifoxSyncApp } from './app';
import { handleConfigInit } from './configInit';
import { printHelp } from './help';
import { addBranchOptions, addWorkflowOptions } from './options';

function spawnMcpServer(): void {
  const mcpServerPath = path.join(__dirname, '../mcp/mcp-server.js');
  spawn('node', [mcpServerPath, ...process.argv.slice(3)], { stdio: 'inherit', shell: true }).on('close', (code) => {
    console.log(`MCP 控制台已退出，代码: ${code}`);
  });
}

export async function runCli(): Promise<void> {
  const argv = process.argv.slice(2);
  const app = new ApifoxSyncApp();

  const program = new Command();
  program.name('api-sync-to-apifox').description('Apifox 接口同步工具').version('1.3.0');

  addWorkflowOptions(
    program
      .command('scan')
      .description('扫描后端接口变更（不执行同步）')
      .allowUnknownOption(),
  ).action(async (_opts, cmd) => {
    const args = resolveCliArgs(cmd.opts(), argv);
    validateCliArgs(args, 'scan');
    await app.scan(args);
  });

  addWorkflowOptions(
    program
      .command('sync')
      .description('同步后端接口到 Apifox')
      .allowUnknownOption(),
  ).action(async (_opts, cmd) => {
    const args = resolveCliArgs(cmd.opts(), argv);
    validateCliArgs(args, 'sync');
    await app.sync(args);
  });

  program
    .command('refresh-plan')
    .description('LLM 更新 syncApis 后重新生成 plan.md')
    .allowUnknownOption()
    .action(async (_opts, cmd) => {
      const args = resolveCliArgs(cmd.opts(), argv);
      await app.refreshPlan(args);
    });

  addWorkflowOptions(
    program
      .command('workflow')
      .description('一键工作流：scan + 分支列表')
      .allowUnknownOption(),
  ).action(async (_opts, cmd) => {
    const args = resolveCliArgs(cmd.opts(), argv);
    validateCliArgs(args, 'scan');
    await app.workflow(args);
  });

  addBranchOptions(
    program
      .command('branches')
      .description('列出 Apifox 项目分支')
      .allowUnknownOption(),
  ).action(async (_opts, cmd) => {
    try {
      await app.listBranches(resolveCliArgs(cmd.opts(), argv));
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  });

  program
    .command('config [action]')
    .description('管理配置文件')
    .action((action?: string) => {
      if (action === 'init') {
        handleConfigInit(stripCommand(argv));
      } else {
        console.log('=== Apifox 同步技能配置 ===\n');
        console.log('api-sync-to-apifox config init  — 初始化配置文件');
      }
    });

  program.command('mcp').description('启动 MCP 交互控制台').allowUnknownOption().action(() => spawnMcpServer());
  program.command('help').description('显示帮助信息').action(() => printHelp());
  program.helpOption('-h, --help', '显示帮助');
  program.addHelpCommand(false);

  if (argv.includes('--help') || argv.includes('-h')) {
    if (argv.length === 1 || (argv.length === 2 && ['scan', 'sync', 'workflow', 'branches'].includes(argv[0]))) {
      printHelp();
      return;
    }
  }

  if (argv.length === 0) {
    console.log('=== Apifox 同步技能 ===\n');
    console.log('可用命令: config init | scan | sync | workflow | branches | mcp | help');
    console.log('各子命令支持 --help 查看参数，常用: --source-path --framework --project-name --quiet --json');
    return;
  }

  await program.parseAsync(process.argv);
}

export async function main(): Promise<void> {
  try {
    await runCli();
  } catch (error) {
    console.error('=== 执行错误 ===');
    ErrorHandler.handleUnexpectedError(error);
    ErrorHandler.logError(error, { operation: 'main' });
    process.exit(1);
  }
}
