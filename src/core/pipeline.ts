import { ApiScanner } from './scanner/ApiScanner';
import ApiComparer from '../modules/comparer';
import ApiFormatter from '../modules/formatter';
import ApifoxSyncer from '../modules/syncer';
import { matchApiByMethodPath, parseApisParam } from '../utils/openapi/apiMatch';
import { ApiInfo, OpenApiDocument } from '../types';
import { appLog } from '../utils/logger';

/** scan → format 流水线编排 */
export class SyncPipeline {
  readonly scanner: ApiScanner;
  readonly comparer: ApiComparer;
  readonly formatter: ApiFormatter;
  readonly syncer: ApifoxSyncer;

  constructor() {
    this.scanner = new ApiScanner();
    this.comparer = new ApiComparer();
    this.formatter = new ApiFormatter();
    this.syncer = new ApifoxSyncer();
  }

  /** 扫描代码并加载 DTO Schema 到 formatter */
  async scanCodeApis(sourcePath: string, framework: string): Promise<ApiInfo[]> {
    const detectedApis = await this.scanner.scanCodeForChanges(sourcePath, framework);
    this.formatter.setDtoSchemas(this.scanner.getDtoSchemas());
    return detectedApis;
  }

  /** 从代码生成并格式化 OpenAPI 文档 */
  generateFormattedDocFromApis(apis: ApiInfo[]): { doc: OpenApiDocument; unformattedCount: number } {
    const rawDoc = this.formatter.generateApiDocFromCode(apis);
    return this.formatter.formatOpenApiDoc(rawDoc);
  }

  /** scan 阶段轻量统计：只生成 raw doc 并计数，不做格式化 */
  countUnformattedFromApis(apis: ApiInfo[]): number {
    const rawDoc = this.formatter.generateApiDocFromCode(apis, { quiet: true });
    return this.formatter.countUnformattedInDoc(rawDoc);
  }

  /** 生成单个指定接口的格式化文档 */
  async generateSingleApiDoc(
    sourcePath: string,
    framework: string,
    method: string,
    apiPath: string,
  ): Promise<any | null> {
    const detectedApis = await this.scanCodeApis(sourcePath, framework);
    const targetApi = matchApiByMethodPath(detectedApis, method, apiPath);
    if (!targetApi) return null;
    return this.generateFormattedDocFromApis([targetApi]).doc;
  }

  /** 生成多个指定接口的格式化文档 */
  async generateMultipleApisDoc(
    sourcePath: string,
    framework: string,
    apisParam: string,
  ): Promise<any | null> {
    const detectedApis = await this.scanCodeApis(sourcePath, framework);
    const apiList = parseApisParam(apisParam);

    if (apiList.length === 0) {
      console.log('无效的接口列表格式，正确格式: "GET:/api/users,POST:/api/orders"');
      return null;
    }

    const targetApis: ApiInfo[] = [];
    const notFound: string[] = [];

    for (const apiSpec of apiList) {
      const matched = matchApiByMethodPath(detectedApis, apiSpec.method, apiSpec.path);
      if (matched) {
        targetApis.push(matched);
      } else {
        notFound.push(`${apiSpec.method.toUpperCase()} ${apiSpec.path}`);
      }
    }

    if (notFound.length > 0) {
      console.log(`以下接口未找到: ${notFound.join(', ')}`);
    }
    if (targetApis.length === 0) return null;

    console.log(`找到 ${targetApis.length} 个指定接口:`);
    targetApis.forEach((api) => console.log(`  ${api.method.toUpperCase()} ${api.path}`));

    return this.generateFormattedDocFromApis(targetApis).doc;
  }
}
