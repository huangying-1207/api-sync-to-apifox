import { configManager } from '../config';
import { ConfigValidator } from './configValidator';
import apifoxMCP from '../mcp/apifox';

export type CliArgs = Record<string, any>;

/** 解析命令行参数并合并配置文件、MCP 凭据 */
export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const parsed: CliArgs = {};
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      parsed['help'] = true;
      i++;
      continue;
    }

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      i++;
      if (i < argv.length && !argv[i].startsWith('--')) {
        let value: any = argv[i];
        if (key === 'api-path' && value && (value.startsWith('C:') || value.includes('\\'))) {
          value = value.replace(/C:\/Program Files\/Git/, '');
          value = value.replace(/\\/g, '/');
        }
        parsed[key] = value;
        i++;
      } else {
        parsed[key] = true;
      }
    } else {
      i++;
    }
  }

  const config = configManager.readConfig();
  if (config) {
    Object.keys(config).forEach((key) => {
      if (parsed[key] === undefined) {
        parsed[key] = (config as any)[key];
      }
    });
  }

  if (parsed['project-name'] && !parsed['apifox-project-id'] && !parsed['apifox-api-key']) {
    const connectionInfo = apifoxMCP.getConnectionInfo(parsed['project-name']);
    if (connectionInfo) {
      parsed['apifox-project-id'] = connectionInfo.projectId;
      parsed['apifox-api-key'] = connectionInfo.apiKey;
      console.log(`使用 MCP 项目 "${parsed['project-name']}" 的连接信息 (ID: ${connectionInfo.projectId})`);
    } else {
      console.warn(`项目 "${parsed['project-name']}" 未连接，将只扫描接口变化`);
      parsed['apifox-project-id'] = null;
      parsed['apifox-api-key'] = null;
    }
  }

  return parsed;
}

/** 校验 scan/sync 所需参数，失败时打印用法并退出 */
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
    console.log('  api-sync-to-apifox sync --source-type swagger --source-path <url>');
  } else {
    console.log('\nUsage:');
    console.log('  api-sync-to-apifox scan --source-type code --source-path <dir> --framework springboot --scan-type changed');
  }

  process.exit(1);
}

/** 过滤掉子命令名，仅保留选项参数 */
export function stripCommand(argv: string[]): string[] {
  const commands = new Set(['scan', 'sync', 'workflow', 'branches', 'config', 'mcp', 'help']);
  if (argv.length > 0 && commands.has(argv[0])) {
    return argv.slice(1);
  }
  return argv;
}
