import {
  containsChinese,
  getDefaultSummary,
  getDefaultParamDescription,
  getDefaultPropDescription,
  getDefaultResponseDescription,
} from '../utils/helper';
import { ApiInfo, OpenApiDocument } from '../types';
import { appLog } from '../utils/logger';

export interface FormatOpenApiResult {
  doc: any;
  unformattedCount: number;
}

class ApiFormatter {
  private dtoSchemas: any;
  private unformattedCount: number;

  constructor() {
    this.dtoSchemas = {};
    this.unformattedCount = 0;
  }

  setDtoSchemas(schemas: any): void {
    this.dtoSchemas = schemas || {};
  }

  javaTypeToOpenApi(javaType: string, visited: Set<string> = new Set()): any {
    if (!javaType) return { type: 'string' };

    const t = javaType.trim();

    if (['Long', 'Integer', 'int', 'long', 'Short', 'short', 'Byte', 'byte'].includes(t)) {
      return { type: 'integer' };
    }
    if (['Double', 'Float', 'double', 'float', 'BigDecimal'].includes(t)) {
      return { type: 'number' };
    }
    if (['Boolean', 'boolean'].includes(t)) {
      return { type: 'boolean' };
    }
    if (t === 'String') {
      return { type: 'string' };
    }
    if (['Date', 'LocalDateTime', 'LocalDate', 'Timestamp', 'Instant', 'ZonedDateTime'].includes(t)) {
      return { type: 'string', format: 'date-time' };
    }
    if (t === 'LocalTime') {
      return { type: 'string', format: 'time' };
    }
    const listMatch = t.match(/^(?:List|Set|Collection)<(.+)>$/);
    if (listMatch) {
      const itemType = this.javaTypeToOpenApi(listMatch[1], visited);
      return { type: 'array', items: itemType.type === 'object' ? { type: 'object' } : itemType };
    }
    if (this.dtoSchemas[t]) {
      if (visited.has(t)) {
        return { type: 'object', description: `${t} (循环引用)` };
      }
      return { type: 'object', properties: this.generateObjectProperties(t, undefined, new Set([...visited, t])) };
    }
    return { type: 'object' };
  }

  /** 格式化 OpenAPI 文档并统计需格式化的接口数（单次遍历） */
  formatOpenApiDoc(doc: OpenApiDocument): FormatOpenApiResult {
    appLog('格式化 API 文档，确保字段说明使用中文...');
    this.unformattedCount = 0;

    if (doc.paths) {
      Object.keys(doc.paths).forEach((path) => {
        const methods = doc.paths[path];
        Object.keys(methods).forEach((method) => {
          const operation = methods[method];
          let needFormat = false;

          if (!operation.summary || !containsChinese(operation.summary)) {
            operation.summary = getDefaultSummary(path, method);
            needFormat = true;
          }

          if (!operation.description || !containsChinese(operation.description)) {
            operation.description = operation.summary;
            needFormat = true;
          }

          if (operation.parameters) {
            operation.parameters = operation.parameters.map((param: any) => {
              if (!param.description || !containsChinese(param.description)) {
                param.description = getDefaultParamDescription(param.name);
                needFormat = true;
              }
              return param;
            });
          }

          if (operation.requestBody && this.formatRequestBody(operation.requestBody)) {
            needFormat = true;
          }

          if (operation.responses && this.formatResponses(operation.responses)) {
            needFormat = true;
          }

          if (needFormat) {
            this.unformattedCount++;
          }
        });
      });
    }

    if (doc.components?.schemas) {
      for (const schemaName of Object.keys(doc.components.schemas)) {
        this.formatSchema(doc.components.schemas[schemaName]);
      }
    }

    if (doc.components?.parameters) {
      Object.keys(doc.components.parameters).forEach((paramName) => {
        const param = doc.components!.parameters![paramName];
        if (!param.description || !containsChinese(param.description)) {
          doc.components!.parameters![paramName] = {
            ...param,
            description: getDefaultParamDescription(paramName),
          };
        }
      });
    }

    return { doc, unformattedCount: this.unformattedCount };
  }

  /** 只读统计：有多少接口的字段说明尚未中文化（不修改文档） */
  countUnformattedInDoc(doc: OpenApiDocument): number {
    let count = 0;
    if (!doc.paths) return 0;

    for (const path of Object.keys(doc.paths)) {
      for (const method of Object.keys(doc.paths[path])) {
        const operation = doc.paths[path][method];
        let needFormat = false;

        if (!operation.summary || !containsChinese(operation.summary)) needFormat = true;
        if (!operation.description || !containsChinese(operation.description)) needFormat = true;

        if (operation.parameters) {
          for (const param of operation.parameters) {
            if (!param.description || !containsChinese(param.description)) needFormat = true;
          }
        }
        if (operation.requestBody && this.schemaNeedsChinese(operation.requestBody)) needFormat = true;
        if (operation.responses) {
          for (const statusCode of Object.keys(operation.responses)) {
            const response = operation.responses[statusCode];
            if (!response.description || !containsChinese(response.description)) needFormat = true;
            const schema = response.content?.['application/json']?.schema;
            if (schema && this.checkSchemaNeedsChinese(schema)) needFormat = true;
          }
        }
        if (needFormat) count++;
      }
    }
    return count;
  }

  private schemaNeedsChinese(requestBody: { description?: string; content?: Record<string, { schema?: unknown }> }): boolean {
    if (requestBody.description && !containsChinese(requestBody.description)) return true;
    const schema = requestBody.content?.['application/json']?.schema;
    return Boolean(schema && this.checkSchemaNeedsChinese(schema));
  }

  private checkSchemaNeedsChinese(schema: unknown): boolean {
    const s = schema as { description?: string; properties?: Record<string, unknown>; type?: string; items?: unknown };
    if (s.description && !containsChinese(s.description)) return true;
    if (s.properties) {
      for (const propName of Object.keys(s.properties)) {
        const prop = s.properties[propName] as { description?: string; type?: string; properties?: Record<string, unknown>; items?: unknown };
        if (!prop.description || !containsChinese(prop.description)) return true;
        if (prop.type === 'object' && prop.properties && this.checkSchemaNeedsChinese(prop)) return true;
        if (prop.type === 'array' && prop.items && this.checkSchemaNeedsChinese(prop.items)) return true;
      }
    }
    return false;
  }

  formatRequestBody(requestBody: any): boolean {
    let changed = false;
    if (requestBody.content && requestBody.content['application/json']) {
      const schema = requestBody.content['application/json'].schema;
      if (schema && this.formatSchema(schema)) {
        changed = true;
      }
    }
    if (requestBody.description && !containsChinese(requestBody.description)) {
      requestBody.description = '请求参数';
      changed = true;
    }
    return changed;
  }

  formatResponses(responses: any): boolean {
    let changed = false;
    Object.keys(responses).forEach((statusCode) => {
      const response = responses[statusCode];
      if (!response.description || !containsChinese(response.description)) {
        response.description = getDefaultResponseDescription(statusCode);
        changed = true;
      }
      if (response.content && response.content['application/json']) {
        const schema = response.content['application/json'].schema;
        if (schema && this.formatSchema(schema)) {
          changed = true;
        }
      }
    });
    return changed;
  }

  formatSchema(schema: any): boolean {
    let changed = false;
    if (schema.description && !containsChinese(schema.description)) {
      schema.description = '数据模型';
      changed = true;
    }

    if (schema.properties) {
      Object.keys(schema.properties).forEach((propName) => {
        const prop = schema.properties[propName];
        if (!prop.description || !containsChinese(prop.description)) {
          prop.description = getDefaultPropDescription(propName);
          changed = true;
        }
        if (prop.type === 'object' && prop.properties && this.formatSchema(prop)) {
          changed = true;
        }
        if (prop.type === 'array' && prop.items?.type === 'object' && prop.items.properties && this.formatSchema(prop.items)) {
          changed = true;
        }
      });
    }

    return changed;
  }

  generateResponseSchema(returnType: string, api: ApiInfo): any {
    if (!returnType || ['String', 'Integer', 'Long', 'Boolean', 'Double', 'Float'].includes(returnType)) {
      return {
        type: 'object',
        properties: {
          code: { type: 'integer', description: '响应码' },
          message: { type: 'string', description: '响应消息' },
          data: {
            type: returnType && returnType.toLowerCase() === 'string' ? 'string' : 'integer',
            description: '响应数据',
          },
        },
      };
    }

    if (returnType.startsWith('List<') || returnType.startsWith('Set<')) {
      const genericTypeMatch = returnType.match(/<([^>]+)>/);
      if (!genericTypeMatch) {
        return {
          type: 'object',
          properties: {
            code: { type: 'integer', description: '响应码' },
            message: { type: 'string', description: '响应消息' },
            data: { type: 'array', description: '响应数据列表', items: { type: 'object' } },
          },
        };
      }
      const genericType = genericTypeMatch[1];
      return {
        type: 'object',
        properties: {
          code: { type: 'integer', description: '响应码' },
          message: { type: 'string', description: '响应消息' },
          data: {
            type: 'array',
            description: '响应数据列表',
            items: {
              type: 'object',
              properties: this.generateObjectProperties(genericType, api),
            },
          },
        },
      };
    }

    if (returnType === 'JSONObject') {
      return {
        type: 'object',
        properties: {
          code: { type: 'integer', description: '响应码' },
          message: { type: 'string', description: '响应消息' },
          data: {
            type: 'object',
            description: '响应数据（JSON 对象）',
            properties: this.generateObjectProperties(returnType, api),
            additionalProperties: true,
          },
        },
      };
    }

    return {
      type: 'object',
      properties: {
        code: { type: 'integer', description: '响应码' },
        message: { type: 'string', description: '响应消息' },
        data: {
          type: 'object',
          description: `响应数据 (${returnType})`,
          properties: this.generateObjectProperties(returnType, api),
        },
      },
    };
  }

  generateObjectProperties(objectType: string, api?: ApiInfo, visited: Set<string> = new Set()): any {
    const props: any = {};
    const baseObjectType = api?.baseType ? api.baseType : objectType;

    if (this.dtoSchemas[baseObjectType]) {
      const fields = this.dtoSchemas[baseObjectType];
      Object.keys(fields).forEach((fieldName) => {
        props[fieldName] = {
          ...this.javaTypeToOpenApi(fields[fieldName], visited),
          description: getDefaultPropDescription(fieldName),
        };
      });
    }

    if (api?.mapFields && Object.keys(api.mapFields).length > 0) {
      Object.keys(api.mapFields).forEach((fieldName) => {
        props[fieldName] = {
          ...api.mapFields![fieldName],
          description: getDefaultPropDescription(fieldName),
        };
      });
    }

    if (Object.keys(props).length > 0) return props;

    return {
      id: { type: 'integer', description: getDefaultPropDescription('id') },
      name: { type: 'string', description: getDefaultPropDescription('name') },
    };
  }

  generateBodySchema(bodyType: string): any {
    const openApiType = this.javaTypeToOpenApi(bodyType);
    if (openApiType.type === 'object' && this.dtoSchemas[bodyType]) {
      openApiType.properties = this.generateObjectProperties(bodyType);
      return openApiType;
    }
    if (['string', 'integer', 'number', 'boolean'].includes(openApiType.type)) {
      return { type: openApiType.type };
    }
    return { type: 'object', description: `请求体 (${bodyType})` };
  }

  generateApiDocFromCode(detectedApis: ApiInfo[], options?: { quiet?: boolean }): OpenApiDocument {
    if (!options?.quiet) {
      appLog('正在根据代码生成接口文档...');
      appLog('检测到的接口数量:', detectedApis.length);
      detectedApis.forEach((api, index) => {
        appLog(`接口 ${index + 1}:`, api.method.toUpperCase(), api.path, '返回类型:', api.returnType);
      });
    }

    const openApiDoc: OpenApiDocument = {
      openapi: '3.0.0',
      info: {
        title: '自动生成的 API 文档',
        version: '1.0.0',
        description: '根据代码自动解析生成的 API 接口文档',
      },
      paths: {},
      components: { schemas: {}, parameters: {} },
    };

    detectedApis.forEach((api) => {
      if (!openApiDoc.paths[api.path]) {
        openApiDoc.paths[api.path] = {};
      }

      const operation: any = {
        summary: `Auto-generated summary for ${api.method.toUpperCase()} ${api.path}`,
        description: `Auto-generated description for ${api.method.toUpperCase()} ${api.path}`,
        tags: [api.controller],
        responses: {
          '200': {
            description: 'Auto-generated success response',
            content: {
              'application/json': {
                schema: this.generateResponseSchema(api.returnType!, api),
              },
            },
          },
        },
      };

      if (api.parameters && api.parameters.length > 0) {
        operation.parameters = api.parameters.map((param) => ({
          name: param.name,
          in: param.type,
          required: true,
          description: `Auto-generated description for ${param.name}`,
          schema: { type: 'string' },
        }));
      }

      if (api.requestBodyType) {
        operation.requestBody = {
          description: '请求参数',
          required: true,
          content: {
            'application/json': {
              schema: this.generateBodySchema(api.requestBodyType),
            },
          },
        };
      }

      openApiDoc.paths[api.path][api.method] = operation;
    });

    return openApiDoc;
  }
}

export default ApiFormatter;
