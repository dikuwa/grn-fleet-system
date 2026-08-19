import { DEPARTURE_INSPECTION_ITEMS, RETURN_INSPECTION_ITEMS } from '@/lib/inspection-checklists';
import {
  createInspectionTemplateVersion,
  listInspectionTemplates,
} from '@/lib/inspection-template-service';

const DEFAULT_TEMPLATES = [
  {
    type: 'departure',
    name: 'Standard Departure Inspection',
    items: DEPARTURE_INSPECTION_ITEMS,
  },
  {
    type: 'return',
    name: 'Standard Return Inspection',
    items: RETURN_INSPECTION_ITEMS,
  },
] as const;

/**
 * Ensure a tenant has a usable baseline inspection checklist for both vehicle
 * issue and return. Existing active tenant templates are never replaced.
 */
export async function ensureDefaultInspectionTemplates(input: {
  tenantId: string;
  userId: string;
}) {
  const existing = await listInspectionTemplates(input.tenantId);
  const activeTypes = new Set(
    existing.filter((template) => template.isActive).map((template) => template.type),
  );
  const created: Array<{ id: string; type: string; name: string; version: number }> = [];

  for (const template of DEFAULT_TEMPLATES) {
    if (activeTypes.has(template.type)) continue;

    const result = await createInspectionTemplateVersion({
      tenantId: input.tenantId,
      userId: input.userId,
      name: template.name,
      type: template.type,
      items: template.items,
    });

    created.push({
      id: result.id,
      type: result.type,
      name: result.name,
      version: result.version,
    });
  }

  return {
    created,
    createdCount: created.length,
    ready: DEFAULT_TEMPLATES.every((template) =>
      activeTypes.has(template.type) || created.some((item) => item.type === template.type),
    ),
  };
}
