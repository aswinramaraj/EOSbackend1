import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

export interface HigherEducationSchemaFlags {
  /** student_higher_education.admission_status/offer_status/visa_status/scholarship_value/sop_status/etc — the coordinator-tracking columns added on top of the original preferred_course/preferred_country/preferred_university/remarks. */
  extended: boolean;
  /** student_higher_education.cgpa/percentage/test_scores_summary — added for the Add Aspirant form. */
  academics: boolean;
  /** higher_education_standing_returns — the NAAC/NBA/AISHE/management-review filing register on the Reports page. */
  standingReturns: boolean;
  /** higher_education_calendar_events — events the cell adds to the merged academic calendar. */
  calendarEvents: boolean;
}

interface PresenceRow {
  name: string;
}

/**
 * Single cheap existence check against information_schema, mirroring the
 * Transport module's `detectTransportSchema` pattern. `student_higher_education`
 * predates this dashboard (it originally only had preferred_course/
 * preferred_country/preferred_university/remarks for students to self-declare
 * interest); the coordinator-tracking columns were added later by hand, so the
 * Prisma client's generated type doesn't know about them and every query
 * against them goes through $queryRaw.
 */
export async function detectHigherEducationSchema(prisma: PrismaService): Promise<HigherEducationSchemaFlags> {
  const rows = await prisma.$queryRaw<PresenceRow[]>(Prisma.sql`
    SELECT 'extended' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'student_higher_education' AND column_name = 'admission_status'
    )
    UNION ALL
    SELECT 'academics' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'student_higher_education' AND column_name = 'cgpa'
    )
    UNION ALL
    SELECT 'standingReturns' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'higher_education_standing_returns'
    )
    UNION ALL
    SELECT 'calendarEvents' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'higher_education_calendar_events'
    )
  `);
  const present = new Set(rows.map((r) => r.name));
  return {
    extended: present.has('extended'),
    academics: present.has('academics'),
    standingReturns: present.has('standingReturns'),
    calendarEvents: present.has('calendarEvents'),
  };
}
