import { ApiInfo } from '../../types';
import type { LlmResponseFieldSupplement } from '../../types/llmPlanContext';

export function applyResponseFieldSupplements(
  apis: ApiInfo[],
  supplements?: LlmResponseFieldSupplement[],
): string[] {
  const warnings: string[] = [];
  if (!supplements?.length) return warnings;

  for (const api of apis) {
    const supplement = supplements.find(
      (item) => item.method.toLowerCase() === api.method.toLowerCase() && item.path === api.path,
    );
    if (!supplement?.mapFields || Object.keys(supplement.mapFields).length === 0) continue;

    api.mapFields = { ...(api.mapFields || {}), ...supplement.mapFields };
    api.needsLlmFieldSupplement = false;
  }

  return warnings;
}
