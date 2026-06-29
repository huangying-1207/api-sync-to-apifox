/**
 * Apifox OpenAPI 导入/导出约定：
 * - export 时 addFoldersToTags 会把接口目录写入 tags[0]
 * - import 时 updateFolderOfChangedEndpoint 会按 tags[0] 更新接口目录
 */
export function getFolderNameFromOpenApiTags(tags: unknown): string | undefined {
  if (!Array.isArray(tags) || tags.length === 0) return undefined;
  const folderName = String(tags[0]).trim();
  return folderName || undefined;
}

export function buildOpenApiTagsForFolder(folderName?: string): string[] | undefined {
  const normalized = folderName?.trim();
  return normalized ? [normalized] : undefined;
}
