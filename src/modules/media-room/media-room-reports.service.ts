import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectMediaRoomSchema, type MediaRoomSchemaFlags } from './media-room-schema.util';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';

export interface ReportRow {
  id: number;
  name: string;
  period: string;
  note: string | null;
  status: string;
  created_by_user_id: number;
  created_at: Date;
  updated_at: Date;
  owner_name: string | null;
}

const REPORT_COLUMNS = Prisma.sql`id, name, period, note, status, created_by_user_id, created_at, updated_at`;

/** Joins in the creator's display name (faculty first/last, falling back to email) — the design's "owner" field. */
function reportSelectWithOwner(where: Prisma.Sql) {
  return Prisma.sql`
    SELECT mr.id, mr.name, mr.period, mr.note, mr.status, mr.created_by_user_id, mr.created_at, mr.updated_at,
      COALESCE(f.first_name || ' ' || f.last_name, u.email) AS owner_name
    FROM media_reports mr
    LEFT JOIN users u ON u.id = mr.created_by_user_id
    LEFT JOIN faculty f ON f.user_id = u.id
    ${where}
  `;
}

interface DepartmentBarRow {
  department: string;
  count: bigint;
}

interface TurnaroundRow {
  created_at: Date;
  delivered_at: Date;
}

const TURNAROUND_BUCKETS = [
  { name: 'Under 24 hours', maxHours: 24 },
  { name: '1 – 3 days', maxHours: 72 },
  { name: '4 – 7 days', maxHours: 168 },
  { name: 'Over a week', maxHours: Infinity },
];

interface AcademicYearWindow {
  label: string;
  start: Date;
  end: Date;
}

/**
 * Same July-ish/June-start convention already used by
 * media-room-attendance.service.ts's academicYearFor — June (month 6)
 * onward belongs to the AY that starts that June; earlier months belong to
 * the AY that started the previous June. yearsAgo=0 is the current AY,
 * yearsAgo=1 is the one before it (the scorecard's "LAST YEAR" column).
 */
function academicYearWindow(yearsAgo: number, reference = new Date()): AcademicYearWindow {
  const calendarYear = reference.getUTCFullYear();
  const month1based = reference.getUTCMonth() + 1;
  const startYear = (month1based >= 6 ? calendarYear : calendarYear - 1) - yearsAgo;
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    start: new Date(Date.UTC(startYear, 5, 1)),
    end: new Date(Date.UTC(startYear + 1, 5, 1)),
  };
}

const SCORECARD_METRICS = [
  { key: 'requests_handled', name: 'Requests handled', isPercent: false },
  { key: 'on_time_delivery', name: 'On-time delivery', isPercent: true },
  { key: 'events_covered', name: 'Events covered', isPercent: false },
  { key: 'posts_published', name: 'Posts published', isPercent: false },
  { key: 'app_accounts_reached', name: 'App accounts reached', isPercent: false },
  { key: 'comments_answered_4hr', name: 'Comments answered in 4 hrs', isPercent: false },
  { key: 'equipment_utilisation', name: 'Equipment utilisation', isPercent: true },
] as const;

export interface ScorecardMetricOut {
  key: string;
  name: string;
  is_percent: boolean;
  now: number | null;
  prev: number | null;
  target: number | null;
  attainment_pct: number | null;
}

/** Saved reports log — media_reports (new table, not in schema.prisma). Names/describes a report someone intends to compile; never fabricates the report's actual contents. */
@Injectable()
export class MediaRoomReportsService {
  private readonly logger = new Logger(MediaRoomReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const schema = await detectMediaRoomSchema(this.prisma);
    if (!schema.reports) return { ready: false, data: [] };

    try {
      const rows = await this.prisma.$queryRaw<ReportRow[]>(
        reportSelectWithOwner(Prisma.sql`ORDER BY mr.created_at DESC`),
      );
      return { ready: true, data: rows };
    } catch (err) {
      this.logger.error('DB error listing reports', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  private async findOneRaw(id: number): Promise<ReportRow> {
    const rows = await this.prisma.$queryRaw<ReportRow[]>(Prisma.sql`SELECT ${REPORT_COLUMNS} FROM media_reports WHERE id = ${id}`);
    if (rows.length === 0) throw new NotFoundException({ message: 'Report not found', errorCode: 'REPORT_NOT_FOUND' });
    return rows[0];
  }

  async create(dto: CreateReportDto, userId: number) {
    try {
      const inserted = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO media_reports (name, period, note, created_by_user_id)
        VALUES (${dto.name}, ${dto.period}, ${dto.note ?? null}, ${userId})
        RETURNING id
      `);
      const rows = await this.prisma.$queryRaw<ReportRow[]>(
        reportSelectWithOwner(Prisma.sql`WHERE mr.id = ${inserted[0].id}`),
      );
      return rows[0];
    } catch (err) {
      this.logger.error('DB error creating report', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async updateStatus(id: number, dto: UpdateReportDto) {
    await this.findOneRaw(id);
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE media_reports SET status = ${dto.status}, updated_at = now() WHERE id = ${id}
      `);
      const rows = await this.prisma.$queryRaw<ReportRow[]>(
        reportSelectWithOwner(Prisma.sql`WHERE mr.id = ${id}`),
      );
      return rows[0];
    } catch (err) {
      this.logger.error(`DB error updating report ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async remove(id: number) {
    await this.findOneRaw(id);
    try {
      await this.prisma.$executeRaw(Prisma.sql`DELETE FROM media_reports WHERE id = ${id}`);
      return { id };
    } catch (err) {
      this.logger.error(`DB error deleting report ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  /**
   * GET /me/media-reports/analytics — the two real Report-page panels the
   * mockup fabricates numbers for. "Requests by department" only needs
   * schema.prisma tables (media_requests/faculty/departments), so it's
   * always available. "Turnaround time" needs media_request_status_log
   * (media_social_and_report_extensions.sql) — returns ready:false until
   * that table exists, and it will only fill in as requests are created/
   * updated going forward (no backfill for requests logged before it existed).
   */
  async analytics() {
    const departmentRows = await this.prisma.$queryRaw<DepartmentBarRow[]>(Prisma.sql`
      SELECT COALESCE(d.name, 'Other / internal') AS department, COUNT(*) AS count
      FROM media_requests mr
      LEFT JOIN faculty f ON f.id = mr.requested_by_faculty_id
      LEFT JOIN departments d ON d.id = f.department_id
      GROUP BY COALESCE(d.name, 'Other / internal')
      ORDER BY count DESC
    `);
    const totalRequests = departmentRows.reduce((sum, r) => sum + Number(r.count), 0);
    const byDepartment = departmentRows.map((r) => ({
      name: r.department,
      count: Number(r.count),
      pct: totalRequests > 0 ? Math.round((Number(r.count) / totalRequests) * 100) : 0,
    }));

    const schema = await detectMediaRoomSchema(this.prisma);
    if (!schema.statusLog) {
      return { byDepartment, turnaround: { ready: false, data: [] } };
    }

    try {
      const rows = await this.prisma.$queryRaw<TurnaroundRow[]>(Prisma.sql`
        SELECT mr.created_at, log.delivered_at
        FROM media_requests mr
        JOIN (
          SELECT media_request_id, MIN(changed_at) AS delivered_at
          FROM media_request_status_log
          WHERE status = 'delivered'
          GROUP BY media_request_id
        ) log ON log.media_request_id = mr.id
      `);

      const bucketCounts = TURNAROUND_BUCKETS.map((b) => ({ name: b.name, count: 0 }));
      for (const row of rows) {
        const hours = (row.delivered_at.getTime() - row.created_at.getTime()) / 3_600_000;
        const bucketIndex = TURNAROUND_BUCKETS.findIndex((b) => hours <= b.maxHours);
        bucketCounts[bucketIndex === -1 ? bucketCounts.length - 1 : bucketIndex].count += 1;
      }
      const totalDelivered = rows.length;
      const turnaround = bucketCounts.map((b) => ({
        name: b.name,
        count: b.count,
        pct: totalDelivered > 0 ? Math.round((b.count / totalDelivered) * 100) : 0,
      }));

      return { byDepartment, turnaround: { ready: true, data: turnaround } };
    } catch (err) {
      this.logger.error('DB error computing turnaround analytics', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  // ── Media scorecard — real THIS YEAR/LAST YEAR, real TARGET (media_scorecard_targets) ──

  private async requestsHandled(win: AcademicYearWindow): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS count FROM media_requests
      WHERE status != 'pending' AND created_at >= ${win.start} AND created_at < ${win.end}
    `);
    return Number(rows[0].count);
  }

  /** Requires media_request_status_log (statusLog) AND a poster_needed_by on the request — null (not computable) otherwise, never a fabricated 0. */
  private async onTimeDeliveryPct(win: AcademicYearWindow, schema: { statusLog: boolean }): Promise<number | null> {
    if (!schema.statusLog) return null;
    try {
      const rows = await this.prisma.$queryRaw<{ total: bigint; on_time: bigint }[]>(Prisma.sql`
        WITH delivered AS (
          SELECT mr.poster_needed_by, log.delivered_at
          FROM media_requests mr
          JOIN (
            SELECT media_request_id, MIN(changed_at) AS delivered_at
            FROM media_request_status_log WHERE status = 'delivered' GROUP BY media_request_id
          ) log ON log.media_request_id = mr.id
          WHERE mr.poster_needed_by IS NOT NULL AND mr.created_at >= ${win.start} AND mr.created_at < ${win.end}
        )
        SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE delivered_at::date <= poster_needed_by) AS on_time FROM delivered
      `);
      const total = Number(rows[0].total);
      return total > 0 ? Math.round((Number(rows[0].on_time) / total) * 100) : null;
    } catch (err) {
      this.logger.warn(`Could not compute on-time delivery for ${win.label}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private async eventsCovered(win: AcademicYearWindow): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS count FROM media_shoot_assignments
      WHERE status = 'delivered' AND COALESCE(scheduled_at, created_at) >= ${win.start} AND COALESCE(scheduled_at, created_at) < ${win.end}
    `);
    return Number(rows[0].count);
  }

  private async postsPublished(win: AcademicYearWindow): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS count FROM announcements a
      JOIN users u ON u.id = a.posted_by_user_id
      JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'media_room' AND a.status = 'published' AND a.created_at >= ${win.start} AND a.created_at < ${win.end}
    `);
    return Number(rows[0].count);
  }

  /** Distinct students/staff notified of a Media-Room post — "reached" means notified, not confirmed opened (no read-receipt tracking exists). */
  private async appAccountsReached(win: AcademicYearWindow): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT n.user_id) AS count FROM notifications n
      JOIN announcements a ON a.id = n.related_entity_id AND n.related_entity_type = 'announcement'
      JOIN users u ON u.id = a.posted_by_user_id
      JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'media_room' AND a.created_at >= ${win.start} AND a.created_at < ${win.end}
    `);
    return Number(rows[0].count);
  }

  /** Requires announcement_comments (comments) — null (not computable) otherwise. */
  private async commentsAnsweredIn4Hrs(win: AcademicYearWindow, schema: { comments: boolean }): Promise<number | null> {
    if (!schema.comments) return null;
    try {
      const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS count FROM announcement_comments c
        JOIN announcements a ON a.id = c.announcement_id
        JOIN users u ON u.id = a.posted_by_user_id
        JOIN roles r ON r.id = u.role_id
        WHERE r.name = 'media_room' AND c.parent_comment_id IS NULL
          AND c.created_at >= ${win.start} AND c.created_at < ${win.end}
          AND EXISTS (
            SELECT 1 FROM announcement_comments rep
            WHERE rep.parent_comment_id = c.id AND rep.created_at <= c.created_at + INTERVAL '4 hours'
          )
      `);
      return Number(rows[0].count);
    } catch (err) {
      this.logger.warn(`Could not compute comments-answered for ${win.label}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * No historical inventory-size tracking exists, so this isn't a
   * point-in-time snapshot for past years — it's checkout *frequency*
   * (movements logged in the window ÷ today's total equipment count),
   * computed the same way for every year so the comparison stays fair.
   * Requires equipmentMovements — null (not computable) otherwise.
   */
  private async equipmentUtilisationPct(win: AcademicYearWindow, schema: { equipment: boolean; equipmentMovements: boolean }): Promise<number | null> {
    if (!schema.equipment || !schema.equipmentMovements) return null;
    try {
      const [checkouts, total] = await Promise.all([
        this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
          SELECT COUNT(*) AS count FROM media_equipment_movements
          WHERE note LIKE 'Checked out%' AND moved_at >= ${win.start} AND moved_at < ${win.end}
        `),
        this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS count FROM media_equipment`),
      ]);
      const totalCount = Number(total[0].count);
      return totalCount > 0 ? Math.round((Number(checkouts[0].count) / totalCount) * 100) : null;
    } catch (err) {
      this.logger.warn(`Could not compute equipment utilisation for ${win.label}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private async computeMetric(key: (typeof SCORECARD_METRICS)[number]['key'], win: AcademicYearWindow, schema: MediaRoomSchemaFlags): Promise<number | null> {
    switch (key) {
      case 'requests_handled':
        return this.requestsHandled(win);
      case 'on_time_delivery':
        return this.onTimeDeliveryPct(win, schema);
      case 'events_covered':
        return this.eventsCovered(win);
      case 'posts_published':
        return this.postsPublished(win);
      case 'app_accounts_reached':
        return this.appAccountsReached(win);
      case 'comments_answered_4hr':
        return this.commentsAnsweredIn4Hrs(win, schema);
      case 'equipment_utilisation':
        return this.equipmentUtilisationPct(win, schema);
    }
  }

  /** GET /me/media-reports/scorecard */
  async scorecard() {
    const schema = await detectMediaRoomSchema(this.prisma);
    const thisYear = academicYearWindow(0);
    const lastYear = academicYearWindow(1);

    const targets = schema.scorecardTargets
      ? await this.prisma.$queryRaw<{ metric_key: string; target_value: string }[]>(Prisma.sql`
          SELECT metric_key, target_value FROM media_scorecard_targets WHERE academic_year = ${thisYear.label}
        `)
      : [];
    const targetByKey = new Map(targets.map((t) => [t.metric_key, Number(t.target_value)]));

    const metrics: ScorecardMetricOut[] = [];
    for (const m of SCORECARD_METRICS) {
      const [now, prev] = await Promise.all([this.computeMetric(m.key, thisYear, schema), this.computeMetric(m.key, lastYear, schema)]);
      const target = targetByKey.get(m.key) ?? null;
      metrics.push({
        key: m.key,
        name: m.name,
        is_percent: m.isPercent,
        now,
        prev,
        target,
        attainment_pct: now !== null && target ? Math.round((now / target) * 100) : null,
      });
    }

    return { this_year_label: thisYear.label, last_year_label: lastYear.label, targets_ready: schema.scorecardTargets, metrics };
  }

  /** PUT /me/media-reports/scorecard/targets/:metricKey — upserts this AY's target for one metric. */
  async setScorecardTarget(metricKey: string, targetValue: number, userId: number) {
    if (!SCORECARD_METRICS.some((m) => m.key === metricKey)) {
      throw new NotFoundException({ message: 'Unknown scorecard metric', errorCode: 'UNKNOWN_METRIC' });
    }
    const schema = await detectMediaRoomSchema(this.prisma);
    if (!schema.scorecardTargets) {
      throw new BadRequestException({ message: 'Scorecard targets are not set up yet', errorCode: 'NOT_SET_UP' });
    }
    const thisYear = academicYearWindow(0);
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO media_scorecard_targets (metric_key, academic_year, target_value, updated_by_user_id)
        VALUES (${metricKey}, ${thisYear.label}, ${targetValue}, ${userId})
        ON CONFLICT (metric_key, academic_year) DO UPDATE SET
          target_value = EXCLUDED.target_value, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
      `);
      return { metric_key: metricKey, academic_year: thisYear.label, target_value: targetValue };
    } catch (err) {
      this.logger.error(`DB error setting scorecard target ${metricKey}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  // ── Dashboard "App performance" panel — real, in place of the mockup's hardcoded reach/growth numbers ──

  /**
   * Splits Media Room's published posts into "went through the Explore-feed
   * composer" (has a social_post_details row) vs "plain announcement"
   * (doesn't) — but that split is only meaningful once social_post_details
   * actually exists. Without it, explore/carousel are NOT computable: return
   * null rather than silently falling through to an unfiltered query, which
   * would make both channels show the exact same (wrong-looking) total.
   */
  private async channelPostsAndReach(
    win: { start: Date; end: Date },
    filter: 'explore' | 'carousel' | 'all',
    schema: { socialDetails: boolean },
  ): Promise<{ posts: number | null; reach: number | null }> {
    if (!schema.socialDetails && filter !== 'all') {
      return { posts: null, reach: null };
    }
    const socialJoin =
      filter === 'explore'
        ? Prisma.sql`JOIN social_post_details spd ON spd.announcement_id = a.id`
        : filter === 'carousel'
          ? Prisma.sql`LEFT JOIN social_post_details spd ON spd.announcement_id = a.id`
          : Prisma.sql``;
    const filterClause = filter === 'carousel' ? Prisma.sql`AND spd.announcement_id IS NULL` : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<{ posts: bigint; reach: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT a.id) AS posts, COUNT(DISTINCT n.user_id) AS reach
      FROM announcements a
      JOIN users u ON u.id = a.posted_by_user_id
      JOIN roles r ON r.id = u.role_id
      ${socialJoin}
      LEFT JOIN notifications n ON n.related_entity_id = a.id AND n.related_entity_type = 'announcement'
      WHERE r.name = 'media_room' AND a.status = 'published'
        AND a.created_at >= ${win.start} AND a.created_at < ${win.end}
        ${filterClause}
    `);
    return { posts: Number(rows[0].posts), reach: Number(rows[0].reach) };
  }

  private async pushReach(win: { start: Date; end: Date }) {
    const rows = await this.prisma.$queryRaw<{ posts: bigint; reach: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT a.id) AS posts, COUNT(n.id) AS reach
      FROM announcements a
      JOIN users u ON u.id = a.posted_by_user_id
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN notifications n ON n.related_entity_id = a.id AND n.related_entity_type = 'announcement'
      WHERE r.name = 'media_room' AND a.status = 'published'
        AND a.created_at >= ${win.start} AND a.created_at < ${win.end}
    `);
    return { posts: Number(rows[0].posts), reach: Number(rows[0].reach) };
  }

  private async commentsReach(win: { start: Date; end: Date }, schema: { comments: boolean }): Promise<number> {
    if (!schema.comments) return 0;
    try {
      const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(DISTINCT c.commented_by_user_id) AS count
        FROM announcement_comments c
        JOIN announcements a ON a.id = c.announcement_id
        JOIN users u ON u.id = a.posted_by_user_id
        JOIN roles r ON r.id = u.role_id
        WHERE r.name = 'media_room' AND c.created_at >= ${win.start} AND c.created_at < ${win.end}
      `);
      return Number(rows[0].count);
    } catch {
      return 0;
    }
  }

  private growthPct(now: number | null, prev: number | null): number | null {
    if (now === null || prev === null || prev === 0) return null;
    return Math.round(((now - prev) / prev) * 1000) / 10;
  }

  /**
   * GET /me/media-reports/app-performance — the Dashboard's "App performance"
   * panel. The mockup's 4 channel cards show "students reached"/growth%/post
   * count with zero real backing anywhere (no view/reach-tracking table
   * exists). Redefined honestly using data that does exist: "reached" =
   * distinct accounts actually notified of a post (real, via `notifications`
   * — not confirmed opened, since there's no read-receipt tracking), split by
   * whether the post went through the Social Publishing composer (Explore
   * feed, has a social_post_details row) or not (Announcements carousel).
   * Growth % compares the last 30 days to the 30 days before that.
   */
  async appPerformance() {
    const schema = await detectMediaRoomSchema(this.prisma);
    const now = new Date();
    const currentWindow = { start: new Date(now.getTime() - 30 * 86_400_000), end: now };
    const previousWindow = { start: new Date(now.getTime() - 60 * 86_400_000), end: currentWindow.start };

    const [exploreNow, explorePrev, carouselNow, carouselPrev, pushNow, pushPrev, commentsNow, commentsPrev] = await Promise.all([
      this.channelPostsAndReach(currentWindow, 'explore', schema),
      this.channelPostsAndReach(previousWindow, 'explore', schema),
      this.channelPostsAndReach(currentWindow, 'carousel', schema),
      this.channelPostsAndReach(previousWindow, 'carousel', schema),
      this.pushReach(currentWindow),
      this.pushReach(previousWindow),
      this.commentsReach(currentWindow, schema),
      this.commentsReach(previousWindow, schema),
    ]);

    return {
      channels: [
        { key: 'explore_feed', name: 'Explore feed', posts: exploreNow.posts, reach: exploreNow.reach, growth_pct: this.growthPct(exploreNow.reach, explorePrev.reach) },
        { key: 'announcements_carousel', name: 'Announcements carousel', posts: carouselNow.posts, reach: carouselNow.reach, growth_pct: this.growthPct(carouselNow.reach, carouselPrev.reach) },
        { key: 'push_notifications', name: 'Push notifications', posts: pushNow.posts, reach: pushNow.reach, growth_pct: this.growthPct(pushNow.reach, pushPrev.reach) },
        { key: 'comments_and_replies', name: 'Comments and replies', posts: null, reach: commentsNow, growth_pct: this.growthPct(commentsNow, commentsPrev) },
      ],
    };
  }
}
