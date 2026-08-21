import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

export interface MediaRoomSchemaFlags {
  /** media_team_members. */
  team: boolean;
  /** media_equipment. */
  equipment: boolean;
  /** media_equipment_movements. */
  equipmentMovements: boolean;
  /** media_shoot_assignments. */
  shoots: boolean;
  /** media_indents. */
  indents: boolean;
  /** media_reports. */
  reports: boolean;
  /** media_request_status_log (prisma/manual-sql/media_social_and_report_extensions.sql) — powers Report's real turnaround-time panel. */
  statusLog: boolean;
  /** announcement_comments (same file) — powers the scorecard's "Comments answered in 4 hrs" metric. */
  comments: boolean;
  /** social_post_details (same file) — distinguishes Explore-feed posts from plain announcements for the Dashboard's "App performance" panel. */
  socialDetails: boolean;
  /** media_scorecard_targets (same file) — the scorecard's real, Media-Room-set TARGET column. */
  scorecardTargets: boolean;
}

interface PresenceRow {
  name: string;
}

/**
 * Single cheap existence check against information_schema, mirroring the
 * Medical Centre/Transport/Higher Education modules' schema-detection
 * pattern. These tables are proposed but not yet guaranteed to exist —
 * every service using them checks this flag first and returns an honest
 * "not set up yet" response instead of a 500 when the table is missing.
 * (The whole Employee section — Attendance/Leave/OD/Payslip/Appraisal/
 * Library — ended up on real schema.prisma tables via staff_user_id /
 * borrower_type: staff, so none of it needs a flag here any more.)
 */
export async function detectMediaRoomSchema(prisma: PrismaService): Promise<MediaRoomSchemaFlags> {
  const rows = await prisma.$queryRaw<PresenceRow[]>(Prisma.sql`
    SELECT 'team' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'media_team_members'
    )
    UNION ALL
    SELECT 'equipment' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'media_equipment'
    )
    UNION ALL
    SELECT 'equipmentMovements' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'media_equipment_movements'
    )
    UNION ALL
    SELECT 'shoots' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'media_shoot_assignments'
    )
    UNION ALL
    SELECT 'indents' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'media_indents'
    )
    UNION ALL
    SELECT 'reports' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'media_reports'
    )
    UNION ALL
    SELECT 'statusLog' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'media_request_status_log'
    )
    UNION ALL
    SELECT 'comments' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'announcement_comments'
    )
    UNION ALL
    SELECT 'socialDetails' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'social_post_details'
    )
    UNION ALL
    SELECT 'scorecardTargets' AS name WHERE EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'media_scorecard_targets'
    )
  `);
  const present = new Set(rows.map((r) => r.name));
  return {
    team: present.has('team'),
    equipment: present.has('equipment'),
    equipmentMovements: present.has('equipmentMovements'),
    shoots: present.has('shoots'),
    indents: present.has('indents'),
    reports: present.has('reports'),
    statusLog: present.has('statusLog'),
    comments: present.has('comments'),
    socialDetails: present.has('socialDetails'),
    scorecardTargets: present.has('scorecardTargets'),
  };
}
