/**
 * 项目类型定义
 */

export interface ApiInfo {
  path: string;
  method: string;
  controller?: string;
  file?: string;
  /** Controller 稳定标识，优先用于跨接口目录归类 */
  controllerKey?: string;
  /** Controller 简单类名，如 DramaProjectController */
  controllerClassName?: string;
  /** Controller 上 @Api(tags) / @Tag(name) 的值 */
  controllerTag?: string;
  /** 同步到 Apifox 的目标文件夹名（写入 OpenAPI tags） */
  folderName?: string;
  /** 是否为 Apifox 中尚不存在的新接口 */
  isNewEndpoint?: boolean;
  javaMethodName?: string;
  parameters?: ApiParameter[];
  requestBodyType?: string;
  returnType?: string;
  /** 统一响应包装类简单名，如 Response、Result */
  responseWrapperType?: string;
  /** 包装类中承载业务数据的字段名（从 builder/泛型字段推断） */
  responsePayloadField?: string;
  /** 包装类载荷字段的真实业务类型 */
  responseDataType?: string;
  mapFields?: Record<string, any>;
  baseType?: string;
  summary?: string;
  responseFields?: string[];
}

export interface ApiParameter {
  name: string;
  type: 'path' | 'query' | 'body' | 'header';
  required?: boolean;
  description?: string;
}

export interface ApiComparisonResult {
  added: ApiInfo[];
  updated: ApiInfo[];
  removed: ApiInfo[];
}

export interface FrameworkConfig {
  name: string;
  filePattern: string;
  methodPatterns: { [key: string]: RegExp };
  classPathPattern?: RegExp;
  fileExts: string[];
}

export interface SyncPlanApi {
  method: string;
  path: string;
  controllerClass?: string;
  javaMethodName?: string;
  impactType?: 'request_body' | 'response';
  changeSummary?: string;
}

export interface SyncPlanExcludedApi {
  method: string;
  path: string;
  reason: string;
}

export interface ApifoxBranch {
  id?: number;
  name: string;
  isMain?: boolean;
  isArchived?: boolean;
  type?: string;
}

export interface SyncPlan {
  version: 1;
  status: 'pending' | 'confirmed';
  generatedAt: string;
  changedFiles: string[];
  gitDiff?: string;
  analysis: {
    summary: string;
    affectedApis: SyncPlanApi[];
    excludedApis?: SyncPlanExcludedApi[];
  };
  syncApis: Array<{ method: string; path: string }>;
  userConfirmed: boolean;
  confirmedAt?: string;
  /** 同步目标 Apifox 分支，确认同步前由用户/Agent 指定 */
  targetBranch?: ApifoxBranch;
  /** scan 阶段直接扫描到的 Controller 接口（LLM 分析前的候选） */
  scanCandidates?: SyncPlanApi[];
}

export interface Config {
  'apifox-project-id'?: string;
  'apifox-api-key'?: string;
  'project-name'?: string;
  'source-type': 'code' | 'swagger';
  'source-path': string;
  framework?: 'springboot' | 'nodejs' | 'django';
  'sync-mode'?: 'incremental' | 'full';
  'scan-type'?: 'all' | 'changed';
  'trigger-mode'?: 'auto' | 'manual';
  'api-path'?: string;
  'api-method'?: string;
  apis?: string;
  'sync-plan'?: string;
  /** Apifox 迭代分支 ID，不填则同步到主分支 */
  'apifox-branch-id'?: number;
  /** Apifox 分支名称 */
  'apifox-branch-name'?: string;
  /** 可选分支列表，用于同步前选择；可在 Apifox「管理迭代分支」中查看 ID */
  'apifox-branches'?: ApifoxBranch[];
}

/** CLI 运行时参数（配置文件 + 命令行合并后） */
export interface CliArgs extends Partial<Config> {
  quiet?: boolean;
  json?: boolean;
  help?: boolean;
  'refresh-branches'?: boolean;
  'no-branch-prompt'?: boolean;
  /** 同步时将 OpenAPI 文档写入 temp/formatted-api-doc.json */
  'save-doc'?: boolean;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
    parameters?: Record<string, OpenApiSchema>;
  };
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: OpenApiSchema }> }>;
}

export interface OpenApiParameter {
  name: string;
  in?: string;
  description?: string;
}

export interface OpenApiSchema {
  type?: string;
  description?: string;
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  $ref?: string;
}

export type DtoSchemaMap = Record<string, Record<string, string>>;
