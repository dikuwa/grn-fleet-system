import { seedDefaultIncidentCategories } from '@/lib/incidents/categories';
import { ensureDefaultInspectionTemplates } from '@/lib/inspection-defaults';

/**
 * Seed baseline operational data that is universal to every tenant.
 *
 * Keep tenant-specific policy out of this service. Approval workflow choice,
 * fleet data, departments, payment providers and public request access remain
 * explicit tenant configuration.
 */
export async function seedTenantOperationalDefaults(input: {
  tenantId: string;
  actorUserId: string;
}) {
  const incidentCategories = await seedDefaultIncidentCategories(
    input.tenantId,
    input.actorUserId,
  );
  const inspections = await ensureDefaultInspectionTemplates({
    tenantId: input.tenantId,
    userId: input.actorUserId,
  });

  return {
    incidentCategories: incidentCategories.length,
    inspectionTemplatesCreated: inspections.createdCount,
    inspectionsReady: inspections.ready,
  };
}
