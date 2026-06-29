#!/usr/bin/env node

/**
 * 将 api-sync-to-apifox Cursor Skill 同步到后端项目。
 * Skill 为便携模板（不写死路径）；本机路径写入目标项目的 .apifoxsync.json。
 *
 * 用法:
 *   node scripts/sync-skill.js --path <后端项目根目录>
 *   node scripts/sync-skill.js --path <目录> --name <显示名称>
 *   node scripts/sync-skill.js --target <skill-targets.json 中的 name>
 *   node scripts/sync-skill.js
 *   node scripts/sync-skill.js --list
 */

const fs = require('fs');
const path = require('path');

const TOOL_ROOT = path.resolve(__dirname, '..');
const SKILL_SRC = path.join(TOOL_ROOT, '.cursor', 'skills', 'api-sync-to-apifox', 'SKILL.md');
const DEFAULT_TARGETS_FILE = path.join(__dirname, 'skill-targets.json');
const TOOL_DIST = path.join(TOOL_ROOT, 'dist', 'index.js');

function printHelp() {
  console.log(`
将便携版 Cursor Skill 同步到后端项目，并更新 .apifoxsync.json 中的 sync-tool-path

用法:
  npm run sync-skill -- --path <后端项目根目录> [--name <名称>]
  npm run sync-skill -- --path D:\\IDEA\\proj-a --path D:\\IDEA\\proj-b
  npm run sync-skill -- --target <skill-targets.json 中的 name>
  npm run sync-skill                              # 同步 skill-targets.json 全部目标
  npm run sync-skill -- --list

说明:
  - 复制 SKILL.md（不含本机绝对路径，可提交 Git）
  - 合并写入 <项目>/.apifoxsync.json 的 sync-tool-path（本机路径，不提交 Git）
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    list: false,
    help: false,
    configFile: DEFAULT_TARGETS_FILE,
    targetNames: [],
    pathSpecs: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--list' || arg === '-l') {
      result.list = true;
    } else if ((arg === '--config' || arg === '-c') && args[i + 1]) {
      result.configFile = path.resolve(args[++i]);
    } else if ((arg === '--target' || arg === '-t') && args[i + 1]) {
      result.targetNames.push(args[++i]);
    } else if ((arg === '--path' || arg === '-p') && args[i + 1]) {
      const projectRoot = args[++i];
      let name = path.basename(path.resolve(projectRoot));
      if ((args[i + 1] === '--name' || args[i + 1] === '-n') && args[i + 2]) {
        name = args[i + 2];
        i += 2;
      }
      result.pathSpecs.push({ projectRoot, name });
    } else if (arg === '--name' || arg === '-n') {
      console.warn('提示: --name 需紧跟在 --path 之后');
    } else {
      console.warn(`未知参数: ${arg}`);
    }
  }

  return result;
}

function loadConfigTargets(configFile) {
  if (!fs.existsSync(configFile)) {
    return [];
  }
  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return Array.isArray(config.targets) ? config.targets : [];
  } catch (error) {
    throw new Error(`读取配置失败 ${configFile}: ${error.message}`);
  }
}

function enrichFromApifoxConfig(target) {
  const configPath = path.join(path.resolve(target.projectRoot), '.apifoxsync.json');
  if (!fs.existsSync(configPath)) {
    return target;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      ...target,
      sourcePath: target.sourcePath || cfg['source-path'] || './src/main/java',
      framework: target.framework || cfg.framework || 'springboot',
      name: cfg['project-name'] || target.name,
    };
  } catch {
    return target;
  }
}

function buildTargetFromPath(projectRoot, name) {
  const resolved = path.resolve(projectRoot);
  return enrichFromApifoxConfig({
    name: name || path.basename(resolved),
    projectRoot: resolved,
    sourcePath: './src/main/java',
    framework: 'springboot',
  });
}

function resolveTargets({ pathSpecs, targetNames, configFile }) {
  const configTargets = loadConfigTargets(configFile);

  if (pathSpecs.length > 0) {
    return pathSpecs.map((spec) => buildTargetFromPath(spec.projectRoot, spec.name));
  }

  if (targetNames.length > 0) {
    return targetNames.map((name) => {
      const found = configTargets.find((t) => t.name === name);
      if (!found) {
        throw new Error(`配置中未找到目标 "${name}"（配置文件: ${configFile}）`);
      }
      return enrichFromApifoxConfig(found);
    });
  }

  if (configTargets.length > 0) {
    return configTargets.map((t) => enrichFromApifoxConfig(t));
  }

  return [];
}

/** 合并写入 .apifoxsync.json（保留已有凭据，更新 sync-tool-path 等） */
function mergeApifoxSyncConfig(target) {
  const projectRoot = path.resolve(target.projectRoot);
  const configPath = path.join(projectRoot, '.apifoxsync.json');
  let cfg = {};
  if (fs.existsSync(configPath)) {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  const merged = {
    'source-type': 'code',
    'source-path': './src/main/java',
    framework: 'springboot',
    ...cfg,
    'sync-tool-path': path.resolve(TOOL_DIST),
    'project-name': target.name || cfg['project-name'],
    'source-path': target.sourcePath || cfg['source-path'] || './src/main/java',
    framework: target.framework || cfg.framework || 'springboot',
    'source-type': cfg['source-type'] || 'code',
  };

  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
  return configPath;
}

function removeStaleSkillFiles(destDir) {
  for (const staleName of ['reference.md', 'impact-analysis-template.md']) {
    const stalePath = path.join(destDir, staleName);
    if (fs.existsSync(stalePath)) {
      fs.unlinkSync(stalePath);
    }
  }
}

function syncToTarget(target) {
  const projectRoot = path.resolve(target.projectRoot);
  if (!fs.existsSync(projectRoot)) {
    throw new Error(`目标项目目录不存在: ${projectRoot}`);
  }
  if (!fs.existsSync(SKILL_SRC)) {
    throw new Error(`未找到 Skill 源文件: ${SKILL_SRC}`);
  }

  const destDir = path.join(projectRoot, '.cursor', 'skills', 'api-sync-to-apifox');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(SKILL_SRC, path.join(destDir, 'SKILL.md'));
  removeStaleSkillFiles(destDir);

  const configPath = mergeApifoxSyncConfig(target);

  console.log(`✅ 已同步 Skill → ${destDir}`);
  console.log(`   项目: ${target.name}`);
  console.log(`   - SKILL.md（便携模板，可提交 Git）`);
  console.log(`   - 已更新 ${configPath}`);
  console.log(`     sync-tool-path → ${path.resolve(TOOL_DIST)}`);
}

function main() {
  const parsed = parseArgs();

  if (parsed.help) {
    printHelp();
    return;
  }

  if (parsed.list) {
    const configTargets = loadConfigTargets(parsed.configFile);
    console.log(`配置文件: ${parsed.configFile}`);
    if (configTargets.length === 0) {
      console.log('（无已配置目标，请使用 --path 指定目录）');
      return;
    }
    for (const t of configTargets) {
      console.log(`  - ${t.name}  →  ${path.resolve(t.projectRoot)}`);
    }
    return;
  }

  let selected;
  try {
    selected = resolveTargets(parsed);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  if (selected.length === 0) {
    console.error('❌ 未指定同步目标。请使用 --path 或配置 skill-targets.json\n');
    printHelp();
    process.exit(1);
  }

  if (!fs.existsSync(TOOL_DIST)) {
    console.warn('⚠️  dist/index.js 不存在，请先执行 npm run build\n');
  }

  console.log(`同步 Skill 到 ${selected.length} 个项目...\n`);

  for (const target of selected) {
    try {
      syncToTarget(target);
    } catch (error) {
      console.error(`❌ ${target.name}: ${error.message}`);
      process.exit(1);
    }
  }

  console.log('\n完成。Skill 可提交 Git；.apifoxsync.json（含凭据）请保持 gitignore。');
  console.log('请在目标项目中重新打开 Cursor 对话以加载最新 Skill。');
}

main();
