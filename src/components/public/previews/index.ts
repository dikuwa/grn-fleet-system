/**
 * Public product preview components.
 *
 * Lightweight, static, sanitised visuals that show the GovFleet product in
 * action across the public website. All data is hardcoded demo content —
 * these components never query tenant data or initialise real dashboard
 * libraries, so the public bundle stays light.
 */

export { PreviewShell } from '@/components/public/previews/preview-shell';
export { ProductDashboardPreview } from '@/components/public/previews/product-dashboard-preview';
export { TransportRequestPreview } from '@/components/public/previews/transport-request-preview';
export { ApprovalWorkflowPreview } from '@/components/public/previews/approval-workflow-preview';
export { VehicleAllocationPreview } from '@/components/public/previews/vehicle-allocation-preview';
export { FleetMapPreview } from '@/components/public/previews/fleet-map-preview';
export { DriverSelfServicePreview } from '@/components/public/previews/driver-self-service-preview';
export { AnalyticsPreview } from '@/components/public/previews/analytics-preview';
export { TripAuthorityPreview } from '@/components/public/previews/trip-authority-preview';
export {
  InspectionPreview,
  FuelManagementPreview,
  MaintenancePreview,
} from '@/components/public/previews/operations-control-previews';
