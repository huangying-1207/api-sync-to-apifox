/**
 * 项目类型定义
 */

import type { LlmResponseFieldSupplement } from './llmPlanContext';

export type { LlmResponseFieldSupplement } from './llmPlanContext';

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
  /** 无响应体（public void 等） */
  noResponseBody?: boolean;
  /** 成功响应 HTTP 状态码，如 200 / 202 / 204 */
  responseStatusCode?: string;
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
  needsLlmFieldSupplement?: boolean;
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
  impactType?: string;
  changeSummary?: string;
}

/** 按变更源（Service/DTO/Controller 类）分组的影响分析 */
export interface SyncPlanChangeSource {
  sourceClass: string;
  sourceFile?: string;
  changeType?: string;
  changeDetail?: string;
  businessMeaning?: string;
  /** 确认受影响接口（含直接变更与 Service 间接影响，统一放此数组） */
  affectedApis?: SyncPlanApi[];
  /** 兼容旧数据：渲染时合并入 affectedApis，不再单独展示 */
  serviceIndirectApis?: SyncPlanApi[];
  indirectApis?: SyncPlanApi[];
  excludedApis?: SyncPlanExcludedApi[];
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

/** 变更文件源码，供 LLM 分析 */
export interface SourceFile {
  file: string;
  content: string;
}

export interface SyncPlan {
  version: 1;
  status: 'pending' | 'confirmed';
  generatedAt: string;
  changedFiles: string[];
  gitDiff?: string;
  /** 对比基准 Git 引用（如 origin/main），未设置时表示使用工作区 git status */
  gitBaseBranch?: string;
  /** head=分支提交差异，worktree=含未提交改动 */
  gitCompareMode?: 'head' | 'worktree';
  /** 变更的源文件（含 Controller/Service/DTO 等所有 .java 变更文件），LLM 判断影响面的主要材料 */
  changedSourceFiles?: SourceFile[];
  /** 全量 Controller 源文件，LLM 读接口定义与调用关系 */
  controllerSourceFiles?: SourceFile[];
  /** Apifox 现有接口的 OpenAPI JSON 快照，LLM 判断哪些接口需要更新 */
  apifoxSnapshot?: any;
  analysis: {
    summary: string;
    affectedApis: SyncPlanApi[];
    excludedApis?: SyncPlanExcludedApi[];
    /** LLM 按变更源分组填写，每项 affectedApis 含直接与间接影响 */
    changeSources?: SyncPlanChangeSource[];
  };
  syncApis: Array<{ method: string; path: string }>;
  userConfirmed: boolean;
  confirmedAt?: string;
  targetBranch?: ApifoxBranch;
  /** LLM 填写：JSONObject 响应字段补充 */
  fieldSupplements?: LlmResponseFieldSupplement[];
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
  /** 对比基准 Git 分支/引用，如 origin/main */
  'git-base-branch'?: string;
  /** 分支对比模式：head（默认）或 worktree */
  'git-compare-mode'?: 'head' | 'worktree';
  'trigger-mode'?: 'auto' | 'manual';
  'api-path'?: string;
  'api-method'?: string;
  apis?: string;
  'sync-plan'?: string;
  'apifox-branch-id'?: number;
  'apifox-branch-name'?: string;
  'apifox-branches'?: ApifoxBranch[];
  'sync-tool-path'?: string;
}

/** CLI 运行时参数（配置文件 + 命令行合并后） */
export interface CliArgs extends Partial<Config> {
  quiet?: boolean;
  json?: boolean;
  help?: boolean;
  'refresh-branches'?: boolean;
  'no-branch-prompt'?: boolean;
  'git-fetch'?: boolean;
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
