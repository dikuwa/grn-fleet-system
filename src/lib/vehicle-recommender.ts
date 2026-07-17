/**
 * Vehicle Recommendation Engine
 *
 * A deterministic scoring algorithm that recommends the best vehicle for a
 * given transport request. Considers availability, category suitability,
 * passenger capacity, location proximity, vehicle condition, defect status,
 * and usage balance.
 *
 * Usage:
 *   const engine = new VehicleRecommender();
 *   const result = await engine.findBestMatch(requestId);
 *   // result = { recommendations: [...], topVariant: {...} }
 */

import { getDb } from '@/db';
import {
  vehicles,
  vehicleCategories,
  vehicleDefects,
  vehicleOdometerEvents,
} from '@/db/schema/fleet';
import {
  transportRequests,
  requestActivities,
  requestPassengers,
  requestRoutes,
} from '@/db/schema/requests';
import { eq, and, inArray, sql, isNull } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecommendationVariant = {
  vehicleId: string;
  score: number;
  licenceNumber: string;
  make: string;
  model: string;
  categoryName: string | null;
  passengerCapacity: number | null;
  fuelType: string;
  currentOdometer: number;
  status: string;
  officeId: string | null;
  reasons: string[];
  concerns: string[];
};

export type RecommendationResult = {
  requestId: string;
  scope: string;
  requiredPassengers: number;
  preferredTerrain: string;
  totalEstimatedKm: number;
  recommendations: RecommendationVariant[];
  topVariant: RecommendationVariant | null;
  totalAvailable: number;
};

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

const SCORE = {
  BASE_AVAILABLE: 100,
  CATEGORY_MATCH: 50,
  TERRAIN_MATCH: 30,
  SAME_OFFICE: 25,
  NO_OPEN_DEFECTS: 20,
  PASSENGER_FITS: 15,
  LOW_MILEAGE: 10,
  ROADWORTHY_CURRENT: 10,
  LICENCE_CURRENT: 10,
  DIESEL_PREFERRED_LONG_DISTANCE: 5,
  HIGH_MILEAGE: -10,
  NO_CATEGORY: -15,
  OPEN_DEFECT: -25,
} as const;

// ---------------------------------------------------------------------------
// Recommender class
// ---------------------------------------------------------------------------

export class VehicleRecommender {
  private db: ReturnType<typeof getDb>;

  constructor(opts?: { db?: ReturnType<typeof getDb> }) {
    this.db = opts?.db ?? getDb();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Find the best vehicle match(es) for a given transport request.
   * Returns scored recommendations sorted best-first.
   */
  async findBestMatch(requestId: string): Promise<RecommendationResult> {
    const [request] = await this.db
      .select()
      .from(transportRequests)
      .where(eq(transportRequests.id, requestId))
      .limit(1);

    if (!request) {
      throw new Error(`Transport request ${requestId} not found`);
    }

    // Gather request context
    const [activities, passengers, routes] = await Promise.all([
      this.db
        .select()
        .from(requestActivities)
        .where(eq(requestActivities.requestId, requestId)),
      this.db
        .select()
        .from(requestPassengers)
        .where(eq(requestPassengers.requestId, requestId)),
      this.db
        .select()
        .from(requestRoutes)
        .where(eq(requestRoutes.requestId, requestId)),
    ]);

    const requiredPassengers = passengers.length + 1; // +1 for the requester
    const totalEstimatedKm = activities.reduce(
      (sum, a) => sum + (a.estimatedKilometres ?? 0),
      0,
    );
    const routeDistance = routes.reduce(
      (sum, r) => sum + (r.totalKilometres ?? r.mappedDistanceKm ?? 0),
      0,
    );
    const totalKm = Math.max(totalEstimatedKm, routeDistance);

    // Determine preferred terrain based on scope & route info
    const preferredTerrain = this.inferTerrain(request.scope, totalKm);

    // Find all available vehicles for this tenant
    const availableVehicles = await this.db
      .select({
        id: vehicles.id,
        licenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        make: vehicles.make,
        model: vehicles.model,
        fuelType: vehicles.fuelType,
        transmission: vehicles.transmission,
        currentOdometer: vehicles.currentOdometer,
        status: vehicles.status,
        seatedCapacity: vehicles.seatedCapacity,
        tareKg: vehicles.tareKg,
        roadworthyTestDate: vehicles.roadworthyTestDate,
        licenceExpiryDate: vehicles.licenceExpiryDate,
        categoryId: vehicles.categoryId,
        officeId: vehicles.officeId,
      })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.tenantId, request.tenantId),
          eq(vehicles.isActive, true),
          inArray(vehicles.status, ['available']),
        ),
      );

    if (availableVehicles.length === 0) {
      return {
        requestId,
        scope: request.scope,
        requiredPassengers,
        preferredTerrain,
        totalEstimatedKm: totalKm,
        recommendations: [],
        topVariant: null,
        totalAvailable: 0,
      };
    }

    const vehicleIds = availableVehicles.map((v) => v.id);

    // Load categories, open defects, and recent odometer events in parallel
    const [categories, openDefects, recentOdometerEvents] = await Promise.all([
      this.db
        .select()
        .from(vehicleCategories)
        .where(inArray(vehicleCategories.id, availableVehicles.map((v) => v.categoryId).filter(Boolean) as string[])),
      this.db
        .select({
          vehicleId: vehicleDefects.vehicleId,
          count: sql<number>`count(*)`,
          hasCritical: sql<boolean>`bool_or(severity = 'critical' AND resolved_at IS NULL)`,
          hasBlocking: sql<boolean>`bool_or(is_blocking = true AND resolved_at IS NULL)`,
        })
        .from(vehicleDefects)
        .where(
          and(
            inArray(vehicleDefects.vehicleId, vehicleIds),
            isNull(vehicleDefects.resolvedAt),
          ),
        )
        .groupBy(vehicleDefects.vehicleId),
      this.db
        .select({
          vehicleId: vehicleOdometerEvents.vehicleId,
          maxOdometer: sql<number>`max(odometer_value)`,
          eventCount: sql<number>`count(*)`,
        })
        .from(vehicleOdometerEvents)
        .where(inArray(vehicleOdometerEvents.vehicleId, vehicleIds))
        .groupBy(vehicleOdometerEvents.vehicleId),
    ]);

    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const defectMap = new Map(openDefects.map((d) => [d.vehicleId, d]));
    const odometerEventMap = new Map(
      recentOdometerEvents.map((e) => [e.vehicleId, e]),
    );

    // Score each vehicle
    const scored: RecommendationVariant[] = availableVehicles.map((v) => {
      const reasons: string[] = [];
      const concerns: string[] = [];
      let score = SCORE.BASE_AVAILABLE;

      const category = v.categoryId ? categoryMap.get(v.categoryId) : undefined;
      const defects = defectMap.get(v.id);
      const odometerEvents = odometerEventMap.get(v.id);

      // --- Category match ---
      if (category) {
        score += SCORE.CATEGORY_MATCH;
        reasons.push(`Matched category: ${category.name}`);

        // Passenger capacity check
        const capacity = v.seatedCapacity ?? category.passengerCapacity;
        if (capacity >= requiredPassengers) {
          score += SCORE.PASSENGER_FITS;
          reasons.push(`Seats ${capacity} (need ${requiredPassengers})`);
        } else {
          concerns.push(`Only seats ${capacity}, need ${requiredPassengers}`);
        }

        // Terrain suitability
        if (category.suitableTerrain === preferredTerrain) {
          score += SCORE.TERRAIN_MATCH;
          reasons.push(`Suitable for ${preferredTerrain} terrain`);
        } else if (
          category.suitableTerrain === 'gravel' &&
          preferredTerrain === 'tar'
        ) {
          // Gravel vehicles work fine on tar
          score += 10;
          reasons.push('Gravel vehicle suitable for tar roads');
        } else if (
          preferredTerrain === 'gravel' &&
          category.suitableTerrain === 'tar'
        ) {
          concerns.push('Tar-road vehicle may not be ideal for gravel');
        }
      } else {
        score += SCORE.NO_CATEGORY;
      }

      // --- Category suitability (not just existence) ---
      // The CATEGORY_MATCH score already added above for having a category.
      // Now refine: if the category terrain doesn't match, deduct.
      if (category && category.suitableTerrain && category.suitableTerrain !== preferredTerrain) {
        if (!(category.suitableTerrain === 'gravel' && preferredTerrain === 'tar')) {
          score -= 15;
          concerns.push(`${category.name} not ideal for ${preferredTerrain} terrain`);
        }
      }

      // --- Defect status ---
      if (!defects || defects.count === 0) {
        score += SCORE.NO_OPEN_DEFECTS;
        reasons.push('No open defects');
      } else {
        if (defects.hasCritical) {
          score += SCORE.OPEN_DEFECT * 2;
          concerns.push('Has open critical defect');
        } else if (defects.hasBlocking) {
          score += SCORE.OPEN_DEFECT;
          concerns.push('Has open blocking defect');
        } else {
          concerns.push(`${defects.count} open defect(s)`);
        }
      }

      // --- Mileage / usage balance ---
      const maxOdometer = odometerEvents?.maxOdometer ?? v.currentOdometer;
      if (maxOdometer < 30000) {
        score += SCORE.LOW_MILEAGE;
        reasons.push('Low mileage vehicle');
      } else if (maxOdometer > 100000) {
        score += SCORE.HIGH_MILEAGE;
        concerns.push('High mileage');
      }

      // --- Fuel type for long distances ---
      if (totalKm > 200 && v.fuelType === 'diesel') {
        score += SCORE.DIESEL_PREFERRED_LONG_DISTANCE;
        reasons.push('Diesel preferred for long distance');
      }

      // --- Roadworthy & licence ---
      if (v.roadworthyTestDate) {
        const roadworthyDate = new Date(v.roadworthyTestDate);
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        if (roadworthyDate > oneYearAgo) {
          score += SCORE.ROADWORTHY_CURRENT;
          reasons.push('Roadworthy test current');
        } else {
          concerns.push('Roadworthy test may be outdated');
        }
      }

      if (v.licenceExpiryDate) {
        const expiryDate = new Date(v.licenceExpiryDate);
        if (expiryDate > new Date()) {
          score += SCORE.LICENCE_CURRENT;
          reasons.push('Licence current');
        } else {
          concerns.push('Licence has expired');
        }
      }

      return {
        vehicleId: v.id,
        score,
        licenceNumber: v.licenceNumber,
        make: v.make,
        model: v.model,
        categoryName: category?.name ?? null,
        passengerCapacity: v.seatedCapacity ?? category?.passengerCapacity ?? null,
        fuelType: v.fuelType,
        currentOdometer: v.currentOdometer,
        status: v.status,
        officeId: v.officeId,
        reasons,
        concerns,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return {
      requestId,
      scope: request.scope,
      requiredPassengers,
      preferredTerrain,
      totalEstimatedKm: totalKm,
      recommendations: scored,
      topVariant: scored[0] ?? null,
      totalAvailable: scored.length,
    };
  }

  /**
   * Find the single best vehicle for a request (convenience wrapper).
   */
  async findBestVehicle(
    requestId: string,
  ): Promise<RecommendationVariant | null> {
    const result = await this.findBestMatch(requestId);
    return result.topVariant;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Infer the preferred terrain based on trip scope and distance.
   */
  private inferTerrain(scope: string, totalKm: number): string {
    if (scope === 'national') return 'tar'; // National trips likely use main roads
    if (totalKm > 150) return 'gravel'; // Longer regional trips likely mix
    return 'gravel'; // Short regional trips likely include gravel roads
  }
}
