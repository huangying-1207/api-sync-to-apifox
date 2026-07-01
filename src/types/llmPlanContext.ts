/** LLM 填写：JSONObject 接口响应字段补充 */
export interface LlmResponseFieldSupplement {
  method: string;
  path: string;
  mapFields: Record<string, { type: string; format?: string; description?: string }>;
}
