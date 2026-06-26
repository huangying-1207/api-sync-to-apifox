import { configManager } from '../config';
import { ConfigValidator } from './configValidator';
import apifoxMCP from '../mcp/apifox';
import { commanderOptsToCliArgs } from '../cli/options';
import { CliArgs } from '../types';
import { appLog, appWarn } from './logger';

/** 解析命令行中的 --key value 参数（补充 commander 未声明的选项） */
export function parseArgvFlags(argv: string[]): CliArgs {
  const parsed: CliArgs = {};
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      i++;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      i++;
      if (i < argv.length && !argv[i].startsWith('--')) {
        let value: string | boolean = argv[i];
        if (key === 'api-path' && typeof value === 'string' && (value.startsWith('C:') || value.includes('\\'))) {
          value = value.replace(/C:\/Program Files\/Git/, '').replace(/\\/g, '/');
        }
        (parsed as Record<string, unknown>)[key] = value;
        i++;
      } else {
        (parsed as Record<string, unknown>)[key] = true;
      }
    } else {
      i++;
    }
  }
  return parsed;
}

export function mergeConfigIntoArgs(args: CliArgs): CliArgs {
  const config = configManager.readConfig();
  if (!config) return args;

  const merged = { ...args };
  Object.keys(config).forEach((key) => {
    if ((merged as Record<string, unknown>)[key] === undefined) {
      (merged as Record<string, unknown>)[key] = (config as unknown as Record<string, unknown>)[key];
    }
  });
  return merged;
}

export function resolveMcpCredentials(args: CliArgs): CliArgs {
  if (!args['project-name'] || args['apifox-project-id'] || args['apifox-api-key']) {
    return args;
  }

  const connectionInfo = apifoxMCP.getConnectionInfo(args['project-name']);
  if (connectionInfo) {
    appLog(`使用 MCP 项目 "${args['project-name']}" 的连接信息 (ID: ${connectionInfo.projectId})`);
    return {
      ...args,
      'apifox-project-id': connectionInfo.projectId,
      'apifox-api-key': connectionInfo.apiKey,
    };
  }

  appWarn(`项目 "${args['project-name']}" 未连接，将只扫描接口变化`);
  return { ...args, 'apifox-project-id': undefined, 'apifox-api-key': undefined };
}

/** 合并 commander 选项、argv 补充参数、配置文件与 MCP 凭据 */
export function resolveCliArgs(commanderOpts: Record<string, unknown>, argv: string[]): CliArgs {
  const fromCommander = commanderOptsToCliArgs(commanderOpts);
  const fromArgv = parseArgvFlags(stripCommand(argv));
  const merged: CliArgs = { ...fromArgv, ...fromCommander };

  Object.keys(fromArgv).forEach((key) => {
    if ((fromCommander as Record<string, unknown>)[key] === undefined) {
      (merged as Record<string, unknown>)[key] = (fromArgv as Record<string, unknown>)[key];
    }
  });

  return resolveMcpCredentials(mergeConfigIntoArgs(merged));
}

/** @deprecated 使用 resolveCliArgs；保留供 MCP 等非 commander 入口 */
export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  return resolveMcpCredentials(mergeConfigIntoArgs(parseArgvFlags(stripCommand(argv))));
}

export function validateCliArgs(args: CliArgs, command: 'scan' | 'sync'): void {
  const validationErrors = ConfigValidator.validate(args);
  if (validationErrors.length === 0) return;

  console.error('参数验证失败:');
  validationErrors.forEach((error) => {
    console.error(`- ${error.message}`);
  });

  if (command === 'sync') {
    console.log('\nUsage:');
    console.log('  api-sync-to-apifox sync --source-type code --source-path <dir> --framework springboot');
  } else {
    console.log('\nUsage:');
    console.log('  api-sync-to-apifox scan --source-type code --source-path <dir> --framework springboot --scan-type changed');
  }

  process.exit(1);
}

export function stripCommand(argv: string[]): string[] {
  const commands = new Set(['scan', 'sync', 'workflow', 'branches', 'config', 'mcp', 'help']);
  if (argv.length > 0 && commands.has(argv[0])) {
    return argv.slice(1);
  }
  return argv;
}
