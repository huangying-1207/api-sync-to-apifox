#!/usr/bin/env node

/**
 * 将 api-sync-to-apifox Cursor Skill 同步到后端项目。
 *
 * 用法:
 *   node scripts/sync-skill.js --path <后端项目根目录>              # 推荐：直接指定路径
 *   node scripts/sync-skill.js --path <目录> --name <显示名称>
 *   node scripts/sync-skill.js --target <配置中的 name>            # 从 skill-targets.json 选择
 *   node scripts/sync-skill.js                                    # 同步配置中全部目标
 *   node scripts/sync-skill.js --list                               # 列出配置目标
 *   node scripts/sync-skill.js --config <配置文件路径>
 *
 * 配置: 复制 scripts/skill-targets.example.json → scripts/skill-targets.json 后填写 targets
 */

const fs = require('fs');
const path = require('path');

const TOOL_ROOT = path.resolve(__dirname, '..');
const SKILL_SRC_DIR = path.join(TOOL_ROOT, '.cursor', 'skills', 'api-sync-to-apifox');
const DEFAULT_TARGETS_FILE = path.join(__dirname, 'skill-targets.json');
const TOOL_DIST = path.join(TOOL_ROOT, 'dist', 'index.js');

function printHelp() {
  console.log(`
将 Cursor Skill 同步到后端项目的 .cursor/skills/api-sync-to-apifox/

用法:
  npm run sync-skill -- --path <后端项目根目录> [--name <名称>]
  npm run sync-skill -- --path D:\\IDEA\\proj-a --path D:\\IDEA\\proj-b
  npm run sync-skill -- --target <skill-targets.json 中的 name>
  npm run sync-skill                              # 同步 skill-targets.json 全部目标
  npm run sync-skill -- --list
  npm run sync-skill -- --config <配置文件>

选项:
  --path, -p <目录>     后端项目根目录（可多次指定）
  --name, -n <名称>     与前一个 --path 配对的项目显示名（默认取目录名）
  --target, -t <name>   从配置文件按 name 同步
  --config, -c <文件>   目标配置文件（默认 scripts/skill-targets.json）
  --list, -l            列出配置文件中的目标
  --help, -h            显示帮助

配置:
  复制 scripts/skill-targets.example.json 为 scripts/skill-targets.json
  在 targets 数组中填写各后端项目的 projectRoot、name 等
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
      console.warn('提示: --name 需紧跟在 --path 之后，例如: --path D:\\proj --name my-api');
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
    if (!Array.isArray(config.targets)) {
      return [];
    }
    return config.targets;
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
      name: target.name || cfg['project-name'] || target.name,
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
    const selected = targetNames.map((name) => {
      const found = configTargets.find((t) => t.name === name);
      if (!found) {
        throw new Error(`配置中未找到目标 "${name}"（配置文件: ${configFile}）`);
      }
      return enrichFromApifoxConfig(found);
    });
    return selected;
  }

  if (configTargets.length > 0) {
    return configTargets.map((t) => enrichFromApifoxConfig(t));
  }

  return [];
}

function normalizeDisplayPath(p) {
  return p.replace(/\//g, '\\');
}

function generateProjectSkill(target) {
  const projectRoot = path.resolve(target.projectRoot);
  const projectName = target.name;
  const toolDist = normalizeDisplayPath(TOOL_DIST);
  const projectRootDisplay = normalizeDisplayPath(projectRoot);
  const description =
    target.description ||
    `用 LLM 分析 ${projectName} 代码变更对 API 的影响，生成变更文档供用户确认，确认后才同步到 Apifox。当用户提到接口同步、Apifox、代码变更影响接口时使用。`;

  return `---
name: api-sync-to-apifox
description: >-
  ${description}
---

# ${projectName} — LLM 接口影响分析与 Apifox 同步

**影响分析完全由 LLM 负责**，工具只做：Git 变更检测、Controller 扫描、变更文档生成、Apifox 同步。

## 固定路径

| 项 | 路径 |
|----|------|
| 项目根目录 | \`${projectRootDisplay}\` |
| 同步工具 | \`${toolDist}\` |
| Java 源码 | \`${target.sourcePath || './src/main/java'}\` |

所有命令在 \`${projectRootDisplay}\` 下执行。

## 工作流

\`\`\`
- [ ] Step 1: scan → 生成变更文档草稿
- [ ] Step 2: LLM 分析 git diff → 填写 syncApis
- [ ] Step 3: 展示 apifox-sync-plan.md → 等用户明确确认
- [ ] Step 4: 更新计划为 confirmed → sync
\`\`\`

### Step 1: scan

\`\`\`powershell
cd ${projectRootDisplay}
node ${toolDist} scan
\`\`\`

产出：\`temp/apifox-sync-plan.json\`、\`temp/apifox-sync-plan.md\`

### Step 2: LLM 分析

读取 \`apifox-sync-plan.json\` 的 \`gitDiff\`，分析对 Controller 的影响，更新 \`analysis\` 和 \`syncApis\`。

### Step 3: 用户确认

展示 \`temp/apifox-sync-plan.md\`，**必须等用户明确回复「确认同步」**。

### Step 4: sync

用户确认后更新计划 \`userConfirmed: true\`、\`status: confirmed\`，再执行：

\`\`\`powershell
node ${toolDist} sync --sync-mode incremental
\`\`\`

## Cursor 触发语

> 分析当前代码变更对接口的影响，生成变更文档，我确认后再同步 Apifox

## 附加资源

- [impact-analysis-template.md](impact-analysis-template.md)
- [reference.md](reference.md)
`;
}

function generateProjectReference(target) {
  const projectRoot = normalizeDisplayPath(path.resolve(target.projectRoot));
  const toolDist = normalizeDisplayPath(TOOL_DIST);

  return `# API Sync to Apifox — ${target.name} 参考

工具目录：\`${normalizeDisplayPath(TOOL_ROOT)}\`  
项目目录：\`${projectRoot}\`

## 架构

\`\`\`
Git diff → changedFiles → scanCandidates → apifox-sync-plan.json
         → LLM 填写 syncApis → 用户确认 → sync → Apifox
\`\`\`

## 常用命令（在 ${target.name} 根目录）

\`\`\`powershell
$TOOL = "${toolDist}"

node $TOOL scan
node $TOOL sync --sync-mode incremental   # 需已确认计划
node $TOOL sync --sync-mode full
node $TOOL sync --apis "GET:/api/foo,POST:/api/bar"
\`\`\`

## 更新 Skill

在 api-sync-to-apifox 项目执行：

\`\`\`powershell
cd ${normalizeDisplayPath(TOOL_ROOT)}
npm run build
npm run sync-skill -- --path "${projectRoot}"
\`\`\`

或写入 scripts/skill-targets.json 后执行 npm run sync-skill
`;
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function syncToTarget(target) {
  const projectRoot = path.resolve(target.projectRoot);
  if (!fs.existsSync(projectRoot)) {
    throw new Error(`目标项目目录不存在: ${projectRoot}`);
  }

  const destDir = path.join(projectRoot, '.cursor', 'skills', 'api-sync-to-apifox');
  fs.mkdirSync(destDir, { recursive: true });

  const templateSrc = path.join(SKILL_SRC_DIR, 'impact-analysis-template.md');
  if (fs.existsSync(templateSrc)) {
    copyFile(templateSrc, path.join(destDir, 'impact-analysis-template.md'));
  }

  fs.writeFileSync(path.join(destDir, 'SKILL.md'), generateProjectSkill(target), 'utf8');
  fs.writeFileSync(path.join(destDir, 'reference.md'), generateProjectReference(target), 'utf8');

  console.log(`✅ 已同步 Skill → ${destDir}`);
  console.log(`   项目: ${target.name}`);
  console.log(`   - SKILL.md`);
  console.log(`   - reference.md`);
  if (fs.existsSync(templateSrc)) {
    console.log(`   - impact-analysis-template.md`);
  }
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
      console.log('（无已配置目标，请使用 --path 指定目录，或编辑 skill-targets.json）');
      console.log(`示例: npm run sync-skill -- --path D:\\IDEA\\your-project`);
      return;
    }
    console.log('已配置目标:');
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

  console.log('\n完成。请在目标项目中重新打开 Cursor 对话以加载最新 Skill。');
}

main();
