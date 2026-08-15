import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

export interface TransportSchemaFlags {
  /** buses.status / buses.capacity / buses.odometer_km / buses.next_service_due_km / buses.driver_licence_expiry / buses.driver_phone / buses.attendant_* */
  fleetExtras: boolean;
  /** bus_documents table (statutory compliance dates per bus) */
  documents: boolean;
  /** transport_notices table */
  notices: boolean;
  /** expense_categories row named 'Vehicle Fuel' */
  fuelTracking: boolean;
  /** bus_service_logs table (service/repair history entries) */
  serviceLog: boolean;
  /** buses.model + transport_routes.distance_km/boarding_area/departure_time/arrival_time */
  extendedSpecs: boolean;
  /** student_transport_mapping.bus_id — lets ridership be counted per bus instead of shared across a route's buses */
  perBusRidership: boolean;
  /** buses.chassis_no + the rest of the vehicle-spec-sheet columns, and driver_experience_years/driver_blood_group */
  vehicleSpecs: boolean;
  /** transport_stages.pickup_time — per-stop time on the bus-detail route timeline */
  stageTimes: boolean;
  /** bus_fuel_logs table */
  fuelLog: boolean;
  /** bus_safety_checks table */
  safetyChecks: boolean;
}

interface PresenceRow {
  name: string;
}

export const DOC_TYPE_LABEL: Record<string, string> = {
  insurance: 'Insurance',
  fitness_certificate: 'Fitness certificate',
  permit: 'Permit',
  pollution_certificate: 'Pollution under control',
  road_tax: 'Road tax',
};

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Single cheap existence check against information_schema — decides which
 * of the extended-tracking queries are safe to run, shared by every
 * transport-module service. Avoids guessing from caught error messages, and
 * avoids each service re-implementing this same check.
 */
export async function detectTransportSchema(prisma: PrismaService): Promise<TransportSchemaFlags> {
  const rows = await prisma.$queryRaw<PresenceRow[]>(Prisma.sql`
    SELECT 'fleetExtras' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'buses' AND column_name = 'status'
    )
    UNION ALL
    SELECT 'documents' WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'bus_documents'
    )
    UNION ALL
    SELECT 'notices' WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'transport_notices'
    )
    UNION ALL
    SELECT 'fuelTracking' WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'expense_categories'
    ) AND EXISTS (
      SELECT 1 FROM expense_categories WHERE name = 'Vehicle Fuel'
    )
    UNION ALL
    SELECT 'serviceLog' WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'bus_service_logs'
    )
    UNION ALL
    SELECT 'extendedSpecs' WHERE EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'buses' AND column_name = 'model'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'transport_routes' AND column_name = 'distance_km'
    )
    UNION ALL
    SELECT 'perBusRidership' WHERE EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'student_transport_mapping' AND column_name = 'bus_id'
    )
    UNION ALL
    SELECT 'vehicleSpecs' WHERE EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'buses' AND column_name = 'chassis_no'
    )
    UNION ALL
    SELECT 'stageTimes' WHERE EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'transport_stages' AND column_name = 'pickup_time'
    )
    UNION ALL
    SELECT 'fuelLog' WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'bus_fuel_logs'
    )
    UNION ALL
    SELECT 'safetyChecks' WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'bus_safety_checks'
    )
  `);
  const present = new Set(rows.map((r) => r.name));
  return {
    fleetExtras: present.has('fleetExtras'),
    documents: present.has('documents'),
    notices: present.has('notices'),
    fuelTracking: present.has('fuelTracking'),
    serviceLog: present.has('serviceLog'),
    extendedSpecs: present.has('extendedSpecs'),
    perBusRidership: present.has('perBusRidership'),
    vehicleSpecs: present.has('vehicleSpecs'),
    stageTimes: present.has('stageTimes'),
    fuelLog: present.has('fuelLog'),
    safetyChecks: present.has('safetyChecks'),
  };
}
