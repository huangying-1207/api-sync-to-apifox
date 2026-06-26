import { buildApiMapKey } from '../utils/openapi/apiKey';
import { computeApiDiff } from '../utils/openapi/apiDiff';
import { ApiComparisonResult, ApiInfo } from '../types';

class ApiComparer {
  public scanResults: ApiComparisonResult;

  constructor() {
    this.scanResults = { added: [], updated: [], removed: [] };
  }

  /**
   * 比较接口变化
   * @param incremental 是否增量模式，增量模式下只对检测到的 Controller 范围内做删除判定
   */
  compareApiChanges(detectedApis: ApiInfo[], existingApis: ApiInfo[], incremental: boolean = false): ApiComparisonResult {
    console.log('正在比较接口变化...');
    this.scanResults = { added: [], updated: [], removed: [] };

    const detectedMap = new Map<string, ApiInfo>();
    detectedApis.forEach((api) => {
      detectedMap.set(buildApiMapKey(api.method, api.path), api);
    });

    const existingMap = new Map<string, ApiInfo>();
    existingApis.forEach((api) => {
      existingMap.set(buildApiMapKey(api.method, api.path), api);
    });

    detectedApis.forEach((api) => {
      const key = buildApiMapKey(api.method, api.path);
      if (!existingMap.has(key)) {
        this.scanResults.added.push(api);
      }
    });

    const scannedControllers = new Set(detectedApis.map((api) => api.controller).filter(Boolean) as string[]);
    existingApis.forEach((api) => {
      const key = buildApiMapKey(api.method, api.path);
      if (!detectedMap.has(key)) {
        if (incremental && !scannedControllers.has(api.controller || '')) {
          return;
        }
        this.scanResults.removed.push(api);
      }
    });

    detectedApis.forEach((api) => {
      const key = buildApiMapKey(api.method, api.path);
      const existingApi = existingMap.get(key);
      if (existingApi && computeApiDiff(api, existingApi).hasChanges) {
        this.scanResults.updated.push(api);
      }
    });

    console.log(
      `接口变化统计: 新增 ${this.scanResults.added.length}, 更新 ${this.scanResults.updated.length}, 删除 ${this.scanResults.removed.length}`,
    );
    this.outputChangeDetails(existingApis);

    return this.scanResults;
  }

  outputChangeDetails(existingApis: ApiInfo[]): void {
    console.log('\n=== 接口变化详细信息 ===');

    const existingMap = new Map<string, ApiInfo>();
    existingApis.forEach((api) => {
      existingMap.set(buildApiMapKey(api.method, api.path), api);
    });

    interface GroupedChange {
      added: ApiInfo[];
      updated: ApiInfo[];
      removed: ApiInfo[];
    }
    const byController = new Map<string, GroupedChange>();

    const getGroup = (controller: string): GroupedChange => {
      if (!byController.has(controller)) {
        byController.set(controller, { added: [], updated: [], removed: [] });
      }
      return byController.get(controller)!;
    };

    this.scanResults.added.forEach((api) => getGroup(api.controller || '未知类').added.push(api));
    this.scanResults.updated.forEach((api) => getGroup(api.controller || '未知类').updated.push(api));
    this.scanResults.removed.forEach((api) => getGroup(api.controller || '未知类').removed.push(api));

    if (byController.size === 0) {
      console.log('');
      return;
    }

    const { added, updated, removed } = this.scanResults;
    console.log(`共 ${byController.size} 个类受到影响：新增 ${added.length}, 更新 ${updated.length}, 删除 ${removed.length}`);

    byController.forEach((changes, controller) => {
      const count = changes.added.length + changes.updated.length + changes.removed.length;
      console.log(`\n📁 ${controller} (${count} 个变更)`);

      changes.added.forEach((api) => console.log(`  ✚ ${api.method.toUpperCase()} ${api.path}`));

      changes.updated.forEach((api) => {
        console.log(`  ⭐ ${api.method.toUpperCase()} ${api.path}`);
        const existingApi = existingMap.get(buildApiMapKey(api.method, api.path));
        if (existingApi) {
          const diff = computeApiDiff(api, existingApi, true);
          if (diff.descriptions.length > 0) {
            console.log(`    变更详情:`);
            diff.descriptions.forEach((change) => console.log(`      - ${change}`));
          }
        }
      });

      changes.removed.forEach((api) => console.log(`  ✖ ${api.method.toUpperCase()} ${api.path}`));
    });

    console.log('');
  }
}

export default ApiComparer;
