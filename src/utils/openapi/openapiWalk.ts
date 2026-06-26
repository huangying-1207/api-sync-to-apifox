import { ApiInfo } from '../../types';

/** 从 OpenAPI schema 中提取响应字段名（优先 data 包装体内的业务字段） */
export function extractResponseFieldNamesFromSchema(schema: any, componentSchemas?: any): string[] {
  const fields: string[] = [];

  const resolveSchema = (s: any): any => {
    if (s?.$ref && componentSchemas) {
      const refName = s.$ref.split('/').pop();
      return componentSchemas[refName] || null;
    }
    return s;
  };

  const collectFields = (s: any, depth: number = 0): void => {
    if (!s || depth > 3) return;

    const resolved = resolveSchema(s);
    if (!resolved) return;

    if (resolved.properties?.data) {
      const dataSchema = resolveSchema(resolved.properties.data);
      if (dataSchema?.properties) {
        Object.keys(dataSchema.properties).forEach((key) => {
          if (!fields.includes(key)) fields.push(key);
        });
      }
      if (dataSchema?.type === 'array' && dataSchema?.items) {
        collectFields(dataSchema.items, depth + 1);
      }
      if (dataSchema?.$ref) {
        collectFields(dataSchema, depth + 1);
      }
      return;
    }

    if (resolved.properties) {
      Object.keys(resolved.properties).forEach((key) => {
        if (!fields.includes(key)) fields.push(key);
      });
    }

    if (resolved.type === 'array' && resolved.items) {
      collectFields(resolved.items, depth + 1);
    }
  };

  collectFields(schema);
  return fields;
}

function extractApiFromOperation(
  apiPath: string,
  method: string,
  methodDetails: any,
  openApiDoc: any,
  detailed: boolean,
): ApiInfo {
  const api: ApiInfo = {
    path: apiPath,
    method: method.toLowerCase(),
    summary: methodDetails.summary || '未命名接口',
    parameters: [],
  };

  if (!detailed) {
    return api;
  }

  if (methodDetails.parameters && Array.isArray(methodDetails.parameters)) {
    for (const param of methodDetails.parameters) {
      api.parameters!.push({
        name: param.name,
        type: param.in || 'query',
      });
    }
  }

  if (methodDetails.requestBody?.content) {
    for (const contentType of Object.keys(methodDetails.requestBody.content)) {
      const schema = methodDetails.requestBody.content[contentType].schema;
      if (schema) {
        api.requestBodyType = schema.$ref ? schema.$ref.split('/').pop() : schema.type;
        break;
      }
    }
  }

  if (methodDetails.responses?.['200']?.content) {
    for (const contentType of Object.keys(methodDetails.responses['200'].content)) {
      const schema = methodDetails.responses['200'].content[contentType].schema;
      if (schema) {
        if (schema.$ref) {
          api.returnType = schema.$ref.split('/').pop();
        } else if (schema.type === 'array' && schema.items?.$ref) {
          api.returnType = `List<${schema.items.$ref.split('/').pop()}>`;
        } else if (schema.type === 'array' && schema.items?.type) {
          api.returnType = `List<${schema.items.type}>`;
        } else {
          api.returnType = schema.type;
        }
        api.responseFields = extractResponseFieldNamesFromSchema(schema, openApiDoc.components?.schemas);
        break;
      }
    }
  }

  return api;
}

/** 从 OpenAPI 文档提取接口列表 */
export function extractApisFromOpenApiDoc(doc: any, detailed = false): ApiInfo[] {
  const apis: ApiInfo[] = [];
  if (!doc?.paths) return apis;

  for (const [apiPath, methods] of Object.entries(doc.paths)) {
    for (const [method, details] of Object.entries(methods as Record<string, any>)) {
      apis.push(extractApiFromOperation(apiPath, method, details, doc, detailed));
    }
  }
  return apis;
}
