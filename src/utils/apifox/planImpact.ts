/**
 * 同步计划影响接口的收集与去重工具
 *
 * collectAllAffectedApis 负责将 LLM 写入的多路影响来源合并为单一列表：
 *   - plan.analysis.affectedApis      — LLM 直接标记的受影响接口
 *   - source.affectedApis             — 各变更源（ChangeSource）下的直接影响接口
 *   - source.indirectApis             — 各变更源下的间接影响接口（旧字段兼容）
 *
 * 去重以 "METHOD:path" 为 key，后出现的重复条目直接丢弃（保留先出现的描述）。
 */

import path from 'path';
import { SyncPlan, SyncPlanApi, SyncPlanChangeSource } from '../../types';
import { buildApiMapKey } from '../openapi/apiKey';

export function buildSyncPlanApiKey(api: SyncPlanApi): string {
  return buildApiMapKey(api.method, api.path);
}

function collectSourceAffectedApis(source: SyncPlanChangeSource): SyncPlanApi[] {
  return [
    ...(source.affectedApis || []),
    ...(source.indirectApis || []),
  ];
}

export function dedupeSyncPlanApis(apis: SyncPlanApi[]): SyncPlanApi[] {
  const seen = new Map<string, SyncPlanApi>();
  for (const api of apis) {
    const key = buildSyncPlanApiKey(api);
    if (!seen.has(key)) {
      seen.set(key, { ...api, method: api.method.toUpperCase() });
    }
  }
  return [...seen.values()];
}

/** 汇总所有来源的受影响接口（affectedApis + changeSources），去重后只展示一次 */
export function collectAllAffectedApis(plan: SyncPlan): SyncPlanApi[] {
  const pools = [...plan.analysis.affectedApis];
  for (const source of plan.analysis.changeSources || []) {
    pools.push(...collectSourceAffectedApis(source));
  }
  return dedupeSyncPlanApis(pools);
}

export function formatChangedFileLabel(file: string, cwd = process.cwd()): string {
  const normalized = path.normalize(file);
  if (normalized.startsWith(cwd)) {
    return path.relative(cwd, normalized).replace(/\\/g, '/');
  }
  return path.basename(normalized);
}
