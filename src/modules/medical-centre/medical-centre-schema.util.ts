import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

export interface MedicalCentreSchemaFlags {
  /** medical_visits.status/queued_at — OPD queue tracking added on top of the original visit-record columns. */
  opdQueue: boolean;
  /** medical_staff.on_duty — today's on/off-duty flag. */
  staffDuty: boolean;
  /** medical_staff.qualification/specialization/... — everything the Staff profile page shows. */
  staffProfile: boolean;
  /** sick_room_beds/sick_room_stays — bed register and stay history. */
  sickRoom: boolean;
  /** pharmacy_stock/pharmacy_dispense_log — stock register and dispense log. */
  pharmacy: boolean;
  /** student_health_records — blood group/allergies/chronic condition declared at admission. */
  healthRecords: boolean;
  /** ambulance_status/ambulance_trips. */
  ambulance: boolean;
  /** medical_camps. */
  camps: boolean;
  /** medical_bills/medical_bill_items/medical_services. */
  billing: boolean;
}

interface PresenceRow {
  name: string;
}

/**
 * Single cheap existence check against information_schema, mirroring the
 * Transport/Higher Education modules' schema-detection pattern.
 * medical_staff/medical_visits/medical_equipment predate this module (they
 * already existed in schema.prisma with a seed row each) — every column
 * added on top of them goes through $queryRaw since the Prisma client's
 * generated type doesn't know about them.
 */
export async function detectMedicalCentreSchema(prisma: PrismaService): Promise<MedicalCentreSchemaFlags> {
  const rows = await prisma.$queryRaw<PresenceRow[]>(Prisma.sql`
    SELECT 'opdQueue' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'medical_visits' AND column_name = 'status'
    )
    UNION ALL
    SELECT 'staffDuty' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'medical_staff' AND column_name = 'on_duty'
    )
    UNION ALL
    SELECT 'staffProfile' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'medical_staff' AND column_name = 'qualification'
    )
    UNION ALL
    SELECT 'sickRoom' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'sick_room_beds'
    )
    UNION ALL
    SELECT 'pharmacy' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'pharmacy_stock'
    )
    UNION ALL
    SELECT 'healthRecords' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'student_health_records'
    )
    UNION ALL
    SELECT 'ambulance' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'ambulance_status'
    )
    UNION ALL
    SELECT 'camps' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'medical_camps'
    )
    UNION ALL
    SELECT 'billing' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'medical_bills'
    )
  `);
  const present = new Set(rows.map((r) => r.name));
  return {
    opdQueue: present.has('opdQueue'),
    staffDuty: present.has('staffDuty'),
    staffProfile: present.has('staffProfile'),
    sickRoom: present.has('sickRoom'),
    pharmacy: present.has('pharmacy'),
    healthRecords: present.has('healthRecords'),
    ambulance: present.has('ambulance'),
    camps: present.has('camps'),
    billing: present.has('billing'),
  };
}
