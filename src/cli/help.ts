import fs from 'fs';
import path from 'path';

export function printHelp(): void {
  try {
    const helpContent = fs.readFileSync(path.join(__dirname, '../../help.txt'), 'utf8');
    console.log(helpContent);
  } catch {
    console.log('=== Apifox 同步技能帮助 ===\n');
    console.log('可用命令: config | scan | sync | workflow | branches | mcp | help');
    console.log('运行 api-sync-to-apifox <command> --help 查看参数说明');
  }
}
