/**
 * Predictive Maintenance Engine
 *
 * A deterministic rules-based prediction service that estimates when
 * vehicles are likely to need maintenance based on:
 *   - Service history intervals
 *   - Odometer readings vs next-service thresholds
 *   - Time-based intervals from last service
 *   - Vehicle age, compliance dates, and usage patterns
 *
 * This is NOT a machine learning model — it uses explicit fleet-management
 * rules that are transparent and auditable. The architecture is designed so
 * that a real ML model can replace the rule scoring in a future version.
 */

import { getDb } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { eq, and, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaintenancePrediction {
  vehicleId: string;
  licenceNumber: string;
  make: string;
  model: string;
  currentOdometer: number;
  status: string;

  /** Overall urgency score 0–100 (higher = more urgent) */
  urgencyScore: number;

  /** Predicted next service date based on patterns */
  predictedServiceDate: string | null;

  /** Predicted service odometer based on usage rate */
  predictedServiceOdometer: number | null;

  /** How many km since last service */
  kmSinceLastService: number | null;

  /** How many days since last service */
  daysSinceLastService: number | null;

  /** Average km per day based on odometer history */
  averageKmPerDay: number | null;

  /** Next scheduled service date (from maintenance records) */
  nextScheduledDate: string | null;

  /** Next scheduled odometer threshold */
  nextScheduledOdometer: number | null;

  /** Compliance risks that could trigger maintenance */
  complianceFlags: string[];

  /** Service recommendations */
  recommendations: string[];

  /** Individual factor scores for transparency */
  factors: {
    name: string;
    score: number; // 0–100
    weight: number; // 0–1
    detail: string;
  }[];
}

export interface PredictionSummary {
  predictions: MaintenancePrediction[];
  summary: {
    total: number;
    urgent: number;   // score >= 70
    soon: number;     // score >= 40
    normal: number;   // score < 40
    averageUrgency: number;
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const DEFAULT_SERVICE_INTERVAL_KM = 15000;
const DEFAULT_SERVICE_INTERVAL_DAYS = 180; // 6 months

export async function generatePredictions(tenantId: string): Promise<PredictionSummary> {
  const db = getDb();

  // Get all active vehicles
  const vehicleRows = await db
    .select({
      id: vehicles.id,
      licenceNumber: vehicles.licenceNumber,
      make: vehicles.make,
      model: vehicles.model,
      currentOdometer: vehicles.currentOdometer,
      status: vehicles.status,
      manufactureYear: vehicles.manufactureYear,
      roadworthyTestDate: vehicles.roadworthyTestDate,
      licenceExpiryDate: vehicles.licenceExpiryDate,
    })
    .from(vehicles)
    .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.isActive, true)));

  // Get latest maintenance events per vehicle
  const vehicleIds = vehicleRows.map((v) => v.id);
  let latestMaintenance: Array<{
    vehicleId: string;
    serviceDate: string;
    serviceOdometer: number | null;
    nextServiceDate: string | null;
    nextServiceOdometer: number | null;
    serviceType: string;
  }> = [];

  if (vehicleIds.length > 0) {
    // Get the most recent maintenance event per vehicle
    const query = sql`
      SELECT DISTINCT ON (m.vehicle_id)
        m.vehicle_id AS "vehicleId",
        m.service_date AS "serviceDate",
        m.service_odometer AS "serviceOdometer",
        m.next_service_date AS "nextServiceDate",
        m.next_service_odometer AS "nextServiceOdometer",
        m.service_type AS "serviceType"
      FROM maintenance_events m
      WHERE m.vehicle_id = ANY(${vehicleIds})
      ORDER BY m.vehicle_id, m.service_date DESC
    `;
    latestMaintenance = await db.execute(query) as unknown as typeof latestMaintenance;
  }

  const maintenanceMap = new Map(latestMaintenance.map((m) => [m.vehicleId, m]));

  const predictions: MaintenancePrediction[] = vehicleRows.map((v) => {
    const lastService = maintenanceMap.get(v.id);
    const now = new Date();
    const factors: MaintenancePrediction['factors'] = [];
    const complianceFlags: string[] = [];
    const recommendations: string[] = [];

    // --- Factor 1: Odometer-based prediction ---
    let kmSinceLastService: number | null = null;
    if (lastService?.serviceOdometer != null) {
      kmSinceLastService = v.currentOdometer - lastService.serviceOdometer;
    } else if (v.currentOdometer > 0) {
      kmSinceLastService = v.currentOdometer;
    }

    let odometerScore = 0;
    let odometerDetail = '';
    if (kmSinceLastService != null && kmSinceLastService > 0) {
      const interval = lastService?.nextServiceOdometer ?? DEFAULT_SERVICE_INTERVAL_KM;
      const ratio = kmSinceLastService / interval;
      odometerScore = Math.min(100, Math.round(ratio * 100));
      odometerDetail = `${kmSinceLastService.toLocaleString()} km since last service (interval: ${interval.toLocaleString()} km, ${Math.round(ratio * 100)}%)`;
      if (ratio >= 1) {
        recommendations.push(`Service overdue — ${kmSinceLastService.toLocaleString()} km since last service`);
      } else if (ratio >= 0.8) {
        recommendations.push(`Service due soon — ${(interval - kmSinceLastService).toLocaleString()} km remaining`);
      }
    } else {
      odometerScore = 10;
      odometerDetail = 'No odometer data available';
    }
    factors.push({ name: 'Odometer Interval', score: odometerScore, weight: 0.35, detail: odometerDetail });

    // --- Factor 2: Time-based prediction ---
    let daysSinceLastService: number | null = null;
    if (lastService?.serviceDate) {
      daysSinceLastService = Math.floor((now.getTime() - new Date(lastService.serviceDate).getTime()) / (1000 * 60 * 60 * 24));
    }

    let timeScore = 0;
    let timeDetail = '';
    if (daysSinceLastService != null) {
      const interval = lastService?.nextServiceDate
        ? Math.max(1, Math.floor((new Date(lastService.nextServiceDate).getTime() - new Date(lastService.serviceDate).getTime()) / (1000 * 60 * 60 * 24)))
        : DEFAULT_SERVICE_INTERVAL_DAYS;
      const ratio = daysSinceLastService / interval;
      timeScore = Math.min(100, Math.round(ratio * 100));
      timeDetail = `${daysSinceLastService} days since last service (interval: ${interval} days, ${Math.round(ratio * 100)}%)`;
      if (ratio >= 1) {
        recommendations.push(`Time-based service overdue — ${daysSinceLastService} days since last service`);
      } else if (ratio >= 0.8) {
        recommendations.push(`Service due within ${interval - daysSinceLastService} days`);
      }
    } else {
      timeScore = 10;
      timeDetail = 'No service history found';
      recommendations.push('First service — establish a baseline');
    }
    factors.push({ name: 'Time Interval', score: timeScore, weight: 0.30, detail: timeDetail });

    // --- Factor 3: Compliance risk ---
    let complianceScore = 0;
    const complianceDetails: string[] = [];
    if (v.licenceExpiryDate) {
      const days = Math.floor((new Date(v.licenceExpiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (days < 0) {
        complianceScore = Math.max(complianceScore, 90);
        complianceFlags.push('Licence expired');
        complianceDetails.push(`Licence expired ${Math.abs(days)} days ago`);
      } else if (days <= 30) {
        complianceScore = Math.max(complianceScore, 60);
        complianceFlags.push('Licence expiring soon');
        complianceDetails.push(`Licence expires in ${days} days`);
      }
    }
    if (v.roadworthyTestDate) {
      const rd = new Date(v.roadworthyTestDate);
      rd.setFullYear(rd.getFullYear() + 1);
      const days = Math.floor((rd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (days < 0) {
        complianceScore = Math.max(complianceScore, 90);
        complianceFlags.push('Roadworthy expired');
        complianceDetails.push(`Roadworthy test expired ${Math.abs(days)} days ago`);
      } else if (days <= 30) {
        complianceScore = Math.max(complianceScore, 50);
        complianceFlags.push('Roadworthy expiring soon');
        complianceDetails.push(`Roadworthy due in ${days} days`);
      }
    }
    if (complianceDetails.length === 0) complianceDetails.push('All compliance items valid');
    factors.push({ name: 'Compliance', score: complianceScore, weight: 0.20, detail: complianceDetails.join('; ') });

    // --- Factor 4: Usage intensity ---
    let usageScore = 0;
    let usageDetail = '';
    const age = v.manufactureYear ? now.getFullYear() - v.manufactureYear : 0;
    if (v.currentOdometer > 0 && age > 0) {
      const kmPerYear = v.currentOdometer / age;
      if (kmPerYear > 40000) {
        usageScore = 70;
        usageDetail = `High usage: ${Math.round(kmPerYear).toLocaleString()} km/year`;
        recommendations.push('High-mileage vehicle — consider reduced service intervals');
      } else if (kmPerYear > 25000) {
        usageScore = 40;
        usageDetail = `Moderate-high usage: ${Math.round(kmPerYear).toLocaleString()} km/year`;
      } else {
        usageScore = 10;
        usageDetail = `Normal usage: ${Math.round(kmPerYear).toLocaleString()} km/year`;
      }
    } else {
      usageScore = 5;
      usageDetail = 'Insufficient data to calculate usage';
    }
    factors.push({ name: 'Usage Intensity', score: usageScore, weight: 0.15, detail: usageDetail });

    // --- Calculate average km/day ---
    let averageKmPerDay: number | null = null;
    if (kmSinceLastService != null && daysSinceLastService != null && daysSinceLastService > 0) {
      averageKmPerDay = Math.round((kmSinceLastService / daysSinceLastService) * 10) / 10;
    }

    // --- Weighted urgency score ---
    const urgencyScore = Math.min(100, Math.round(
      factors.reduce((sum, f) => sum + f.score * f.weight, 0),
    ));

    // --- Predicted next service ---
    let predictedServiceDate: string | null = null;
    let predictedServiceOdometer: number | null = null;

    if (lastService?.serviceDate) {
      const interval = lastService?.nextServiceDate
        ? Math.floor((new Date(lastService.nextServiceDate).getTime() - new Date(lastService.serviceDate).getTime()) / (1000 * 60 * 60 * 24))
        : DEFAULT_SERVICE_INTERVAL_DAYS;
      const predicted = new Date(lastService.serviceDate);
      predicted.setDate(predicted.getDate() + interval);
      if (predicted > now) {
        predictedServiceDate = predicted.toISOString().split('T')[0];
      } else {
        predictedServiceDate = 'Overdue';
      }
    }

    if (lastService?.nextServiceOdometer) {
      predictedServiceOdometer = lastService.nextServiceOdometer;
    } else if (lastService?.serviceOdometer != null) {
      predictedServiceOdometer = lastService.serviceOdometer + DEFAULT_SERVICE_INTERVAL_KM;
    } else if (v.currentOdometer > 0) {
      predictedServiceOdometer = v.currentOdometer + DEFAULT_SERVICE_INTERVAL_KM;
    }

    return {
      vehicleId: v.id,
      licenceNumber: v.licenceNumber,
      make: v.make,
      model: v.model,
      currentOdometer: v.currentOdometer,
      status: v.status,
      urgencyScore,
      predictedServiceDate,
      predictedServiceOdometer,
      kmSinceLastService,
      daysSinceLastService,
      averageKmPerDay,
      nextScheduledDate: lastService?.nextServiceDate ?? null,
      nextScheduledOdometer: lastService?.nextServiceOdometer ?? null,
      complianceFlags,
      recommendations,
      factors,
    };
  });

  predictions.sort((a, b) => b.urgencyScore - a.urgencyScore);

  const urgent = predictions.filter((p) => p.urgencyScore >= 70).length;
  const soon = predictions.filter((p) => p.urgencyScore >= 40 && p.urgencyScore < 70).length;
  const normal = predictions.filter((p) => p.urgencyScore < 40).length;
  const averageUrgency = predictions.length > 0
    ? Math.round(predictions.reduce((s, p) => s + p.urgencyScore, 0) / predictions.length)
    : 0;

  return {
    predictions,
    summary: { total: predictions.length, urgent, soon, normal, averageUrgency },
  };
}
