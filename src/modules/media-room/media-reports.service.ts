import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateReportDto, UpdateReportDto } from './dto/media-report.dto';
import { instant, readyList } from './serialize';

const REPORT_SELECT = {
  id: true,
  name: true,
  period: true,
  note: true,
  status: true,
  created_by_user_id: true,
  created_at: true,
  updated_at: true,
  users: {
    select: {
      email: true,
      faculty: { select: { first_name: true, last_name: true } },
      non_teaching_staff: { select: { first_name: true, last_name: true } },
    },
  },
} as const;

interface OwnerRow {
  email: string;
  faculty: { first_name: string; last_name: string } | null;
  non_teaching_staff: { first_name: string; last_name: string | null }[];
}

interface ReportRow {
  id: number;
  name: string;
  period: string;
  note: string | null;
  status: string;
  created_by_user_id: number;
  created_at: Date;
  updated_at: Date;
  users: OwnerRow;
}

/**
 * Same faculty-then-non_teaching_staff-then-email fallback the media requests
 * service uses. `users` carries no name of its own, so the display name has to
 * come from whichever staff record belongs to that account.
 */
function resolveOwnerName(owner: OwnerRow): string {
  if (owner.faculty) {
    return owner.faculty.first_name + ' ' + owner.faculty.last_name;
  }
  const staff = owner.non_teaching_staff[0];
  if (staff) {
    return staff.last_name
      ? staff.first_name + ' ' + staff.last_name
      : staff.first_name;
  }
  return owner.email;
}

/**
 * Academic year runs June–May, matching `academicYearFor` in the HR requests
 * service so a label written by one module means the same span in the other.
 */
function academicYearBounds(date: Date): {
  label: string;
  start: Date;
  end: Date;
} {
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() + 1 >= 6 ? year : year - 1;
  return {
    // "2026-2027" — the format already stored in media_scorecard_targets.
    // A shorter "2026-27" label would never match the saved rows, which is
    // what made every target read back as null.
    label: startYear + '-' + (startYear + 1),
    start: new Date(Date.UTC(startYear, 5, 1)),
    end: new Date(Date.UTC(startYear + 1, 5, 1)),
  };
}

/** Fixed bucket order so the turnaround panel reads left-to-right by speed. */
const TURNAROUND_BUCKETS = [
  'Same day',
  '1-2 days',
  '3-5 days',
  'Over 5 days',
] as const;

/** The four post formats the publishing tab offers, in the dashboard's order. */
const SOCIAL_FORMATS = [
  'Post',
  'Photo carousel',
  'Video',
  'Announcement card',
] as const;

interface MetricDefinition {
  key: string;
  name: string;
  is_percent: boolean;
}

/**
 * The metric keys already present in media_scorecard_targets — the scorecard
 * the institution actually set targets against. Inventing a different set here
 * would strand those saved targets, so the catalogue follows the data.
 */
const SCORECARD_METRICS: MetricDefinition[] = [
  { key: 'events_covered', name: 'Events covered', is_percent: false },
  { key: 'social_media_posts', name: 'Social media posts', is_percent: false },
  { key: 'photos_published', name: 'Photos published', is_percent: false },
  { key: 'videos_published', name: 'Videos published', is_percent: false },
  {
    key: 'avg_turnaround_days',
    name: 'Avg turnaround (days)',
    is_percent: false,
  },
  {
    key: 'equipment_utilisation_pct',
    name: 'Equipment utilisation',
    is_percent: true,
  },
];

/** Stable key for a format label, e.g. "Photo carousel" -> photo_carousel. */
function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Formats stored lower-case ("image") display as "Image". */
function titleCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function pct(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

function hasCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === code
  );
}

@Injectable()
export class MediaRoomReportsService {
  private readonly logger = new Logger(MediaRoomReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private shape(row: ReportRow) {
    return {
      id: row.id,
      name: row.name,
      period: row.period,
      note: row.note,
      // Seeded rows use 'published' where the client contract says 'final';
      // translating here keeps a finished report from displaying as a draft.
      status: row.status === 'published' ? 'final' : row.status,
      created_by_user_id: row.created_by_user_id,
      created_at: instant(row.created_at),
      updated_at: instant(row.updated_at),
      owner_name: resolveOwnerName(row.users),
    };
  }

  /** GET /me/media-reports */
  async list() {
    const rows = await this.prisma.media_reports.findMany({
      select: REPORT_SELECT,
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    });
    return readyList(rows.map((r) => this.shape(r)));
  }

  /** POST /me/media-reports */
  async create(dto: CreateReportDto, userId: number) {
    try {
      const row = await this.prisma.media_reports.create({
        data: {
          name: dto.name,
          period: dto.period,
          note: dto.note,
          created_by_user_id: userId,
        },
        select: REPORT_SELECT,
      });
      this.logger.log('Media report created: id=' + row.id + ' by user=' + userId);
      return this.shape(row);
    } catch (err) {
      this.logger.error('DB error creating media report', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** PATCH /me/media-reports/:id */
  async update(id: number, dto: UpdateReportDto, userId: number) {
    try {
      const row = await this.prisma.media_reports.update({
        where: { id },
        data: {
          status: dto.status,
          name: dto.name,
          period: dto.period,
          note: dto.note,
          updated_at: new Date(),
        },
        select: REPORT_SELECT,
      });
      this.logger.log('Media report updated: id=' + id + ' by user=' + userId);
      return this.shape(row);
    } catch (err) {
      if (hasCode(err, 'P2025')) {
        throw new NotFoundException({
          message: 'Report not found',
          errorCode: 'NOT_FOUND',
        });
      }
      this.logger.error('DB error updating media report #' + id, err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** DELETE /me/media-reports/:id — the author, or an admin, may remove it. */
  async remove(id: number, user: JwtPayload) {
    const existing = await this.prisma.media_reports.findUnique({
      where: { id },
      select: { id: true, created_by_user_id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Report not found',
        errorCode: 'NOT_FOUND',
      });
    }
    if (existing.created_by_user_id !== user.sub && user.role !== ROLES.ADMIN) {
      throw new ForbiddenException({
        message: 'You can only delete reports you created',
        errorCode: 'FORBIDDEN',
      });
    }

    try {
      await this.prisma.media_reports.delete({ where: { id } });
      this.logger.log('Media report deleted: id=' + id + ' by user=' + user.sub);
      return { message: 'Report deleted successfully' };
    } catch (err) {
      if (hasCode(err, 'P2025')) {
        throw new NotFoundException({
          message: 'Report not found',
          errorCode: 'NOT_FOUND',
        });
      }
      this.logger.error('DB error deleting media report #' + id, err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /me/media-reports/analytics
   *
   * Both panels are real counts:
   *  - "Requests by department" attributes each media request to the raising
   *    faculty member's department; a request raised by non-teaching staff has
   *    no department and is grouped as Unassigned rather than dropped.
   *  - "Turnaround" measures created_at to the first recorded `delivered`
   *    status change. Requests never marked delivered have no turnaround to
   *    measure and are excluded, so the buckets describe completed work only.
   */
  async analytics() {
    try {
      const [departmentRows, turnaroundRows] = await Promise.all([
        this.prisma.$queryRaw<{ name: string; count: bigint }[]>`
          SELECT COALESCE(d.name, 'Unassigned') AS name, COUNT(*) AS count
          FROM media_requests mr
          LEFT JOIN faculty f ON f.id = mr.requested_by_faculty_id
          LEFT JOIN departments d ON d.id = f.department_id
          GROUP BY 1
          ORDER BY 2 DESC, 1 ASC
        `,
        this.prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
          WITH delivered AS (
            SELECT mr.id,
                   mr.created_at,
                   MIN(l.changed_at) AS delivered_at
            FROM media_requests mr
            JOIN media_request_status_log l
              ON l.media_request_id = mr.id
             AND l.status = 'delivered'
            GROUP BY mr.id, mr.created_at
          )
          SELECT bucket, COUNT(*) AS count
          FROM (
            SELECT CASE
                     WHEN EXTRACT(EPOCH FROM (delivered_at - created_at)) / 86400 < 1
                       THEN 'Same day'
                     WHEN EXTRACT(EPOCH FROM (delivered_at - created_at)) / 86400 < 3
                       THEN '1-2 days'
                     WHEN EXTRACT(EPOCH FROM (delivered_at - created_at)) / 86400 < 6
                       THEN '3-5 days'
                     ELSE 'Over 5 days'
                   END AS bucket
            FROM delivered
          ) t
          GROUP BY bucket
        `,
      ]);

      const deptTotal = departmentRows.reduce(
        (sum, r) => sum + Number(r.count),
        0,
      );
      const byDepartment = departmentRows.map((r) => ({
        name: r.name,
        count: Number(r.count),
        pct: pct(Number(r.count), deptTotal),
      }));

      const bucketCounts = new Map(
        turnaroundRows.map((r) => [r.bucket, Number(r.count)]),
      );
      const turnaroundTotal = Array.from(bucketCounts.values()).reduce(
        (a, b) => a + b,
        0,
      );

      return {
        byDepartment,
        turnaround: {
          // Nothing has been delivered yet, so there is no turnaround to
          // report — the panel says so instead of drawing four empty bars.
          ready: turnaroundTotal > 0,
          data: TURNAROUND_BUCKETS.map((name) => {
            const count = bucketCounts.get(name) ?? 0;
            return { name, count, pct: pct(count, turnaroundTotal) };
          }),
        },
      };
    } catch (err) {
      this.logger.error('DB error building media analytics', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /me/media-reports/scorecard
   *
   * This year against last year on the same June–May window, with whatever
   * target the Media Room has saved for the current year. A metric with no
   * target reports a null attainment rather than an invented 100%.
   */
  async scorecard() {
    const now = new Date();
    const thisYear = academicYearBounds(now);
    const lastYear = academicYearBounds(
      new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)),
    );

    try {
      // Kept to three concurrent queries, then two — the Prisma pool this app
      // runs with is deliberately small, so a wide fan-out here would starve
      // other requests.
      const windows = await this.windowMetrics(thisYear, lastYear);
      const [utilisation, targetRows] = await Promise.all([
        this.equipmentUtilisation(),
        this.prisma.media_scorecard_targets.findMany({
          where: { academic_year: thisYear.label },
          select: { metric_key: true, target_value: true },
        }),
      ]);

      const current: Record<string, number | null> = {
        ...windows.now,
        equipment_utilisation_pct: utilisation,
      };
      // Utilisation is a live snapshot of the gear register, not a figure that
      // was recorded per year, so there is no comparable "last year" value.
      const previous: Record<string, number | null> = {
        ...windows.prev,
        equipment_utilisation_pct: null,
      };

      const targets = new Map(
        targetRows.map((t) => [t.metric_key, Number(t.target_value)]),
      );

      return {
        this_year_label: thisYear.label,
        last_year_label: lastYear.label,
        targets_ready: true,
        metrics: SCORECARD_METRICS.map((m) => {
          const value = current[m.key] ?? null;
          const target = targets.get(m.key) ?? null;
          return {
            key: m.key,
            name: m.name,
            is_percent: m.is_percent,
            now: value,
            prev: previous[m.key] ?? null,
            target,
            attainment_pct:
              target !== null && target > 0 && value !== null
                ? Math.round((value / target) * 1000) / 10
                : null,
          };
        }),
      };
    } catch (err) {
      this.logger.error('DB error building media scorecard', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * The five year-scoped scorecard figures, both windows in one pass each.
   *
   * Coverage counts are dated by when the shoot was scheduled rather than when
   * the row was entered, so work booked late for an earlier event still counts
   * against the year it was shot in.
   */
  private async windowMetrics(
    thisYear: { start: Date; end: Date },
    lastYear: { start: Date; end: Date },
  ): Promise<{
    now: Record<string, number | null>;
    prev: Record<string, number | null>;
  }> {
    const cs = thisYear.start;
    const ce = thisYear.end;
    const ps = lastYear.start;
    const pe = lastYear.end;

    const [shoots, social, turnaround] = await Promise.all([
      this.prisma.$queryRaw<
        {
          events_now: bigint;
          events_prev: bigint;
          photos_now: bigint;
          photos_prev: bigint;
          videos_now: bigint;
          videos_prev: bigint;
        }[]
      >`
        SELECT
          COUNT(*) FILTER (
            WHERE status = 'delivered' AND ts >= ${cs} AND ts < ${ce}
          ) AS events_now,
          COUNT(*) FILTER (
            WHERE status = 'delivered' AND ts >= ${ps} AND ts < ${pe}
          ) AS events_prev,
          COUNT(*) FILTER (
            WHERE status = 'delivered' AND output_type ILIKE '%photo%'
              AND ts >= ${cs} AND ts < ${ce}
          ) AS photos_now,
          COUNT(*) FILTER (
            WHERE status = 'delivered' AND output_type ILIKE '%photo%'
              AND ts >= ${ps} AND ts < ${pe}
          ) AS photos_prev,
          COUNT(*) FILTER (
            WHERE status = 'delivered' AND output_type ILIKE '%video%'
              AND ts >= ${cs} AND ts < ${ce}
          ) AS videos_now,
          COUNT(*) FILTER (
            WHERE status = 'delivered' AND output_type ILIKE '%video%'
              AND ts >= ${ps} AND ts < ${pe}
          ) AS videos_prev
        FROM (
          SELECT status,
                 output_type,
                 COALESCE(scheduled_at, created_at) AS ts
          FROM media_shoot_assignments
        ) x
      `,
      this.prisma.$queryRaw<{ now_count: bigint; prev_count: bigint }[]>`
        SELECT
          COUNT(*) FILTER (
            WHERE a.created_at >= ${cs} AND a.created_at < ${ce}
          ) AS now_count,
          COUNT(*) FILTER (
            WHERE a.created_at >= ${ps} AND a.created_at < ${pe}
          ) AS prev_count
        FROM social_post_details spd
        JOIN announcements a ON a.id = spd.announcement_id
      `,
      this.prisma.$queryRaw<
        { now_days: number | null; prev_days: number | null }[]
      >`
        WITH delivered AS (
          SELECT mr.created_at, MIN(l.changed_at) AS delivered_at
          FROM media_requests mr
          JOIN media_request_status_log l
            ON l.media_request_id = mr.id
           AND l.status = 'delivered'
          GROUP BY mr.id, mr.created_at
        )
        SELECT
          AVG(
            EXTRACT(EPOCH FROM (delivered_at - created_at)) / 86400
          ) FILTER (
            WHERE created_at >= ${cs} AND created_at < ${ce}
          )::float AS now_days,
          AVG(
            EXTRACT(EPOCH FROM (delivered_at - created_at)) / 86400
          ) FILTER (
            WHERE created_at >= ${ps} AND created_at < ${pe}
          )::float AS prev_days
        FROM delivered
      `,
    ]);

    const s = shoots[0];
    const so = social[0];
    const t = turnaround[0];

    const round1 = (v: number | null | undefined): number | null =>
      v === null || v === undefined ? null : Math.round(v * 10) / 10;

    return {
      now: {
        events_covered: Number(s?.events_now ?? 0),
        social_media_posts: Number(so?.now_count ?? 0),
        photos_published: Number(s?.photos_now ?? 0),
        videos_published: Number(s?.videos_now ?? 0),
        // Nothing delivered in the window means there is no turnaround to
        // average — reported as null so the row shows "—" instead of zero days.
        avg_turnaround_days: round1(t?.now_days),
      },
      prev: {
        events_covered: Number(s?.events_prev ?? 0),
        social_media_posts: Number(so?.prev_count ?? 0),
        photos_published: Number(s?.photos_prev ?? 0),
        videos_published: Number(s?.videos_prev ?? 0),
        avg_turnaround_days: round1(t?.prev_days),
      },
    };
  }

  /**
   * Share of the gear register that is currently out or in service. Retired
   * items are excluded from both sides so disposals do not depress the figure.
   */
  private async equipmentUtilisation(): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<
      { in_use: bigint; active: bigint }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('checked_out', 'in_service')) AS in_use,
        COUNT(*) FILTER (WHERE status <> 'retired')                     AS active
      FROM media_equipment
    `;
    const active = Number(rows[0]?.active ?? 0);
    if (active === 0) return null;
    return pct(Number(rows[0]?.in_use ?? 0), active);
  }

  /** PUT /me/media-reports/scorecard/targets/:metricKey */
  async setTarget(metricKey: string, targetValue: number, userId: number) {
    const known = SCORECARD_METRICS.some((m) => m.key === metricKey);
    if (!known) {
      throw new NotFoundException({
        message: 'Unknown scorecard metric',
        errorCode: 'NOT_FOUND',
      });
    }

    const academicYear = academicYearBounds(new Date()).label;

    try {
      const row = await this.prisma.media_scorecard_targets.upsert({
        where: {
          metric_key_academic_year: {
            metric_key: metricKey,
            academic_year: academicYear,
          },
        },
        create: {
          metric_key: metricKey,
          academic_year: academicYear,
          target_value: targetValue,
          updated_by_user_id: userId,
        },
        update: {
          target_value: targetValue,
          updated_by_user_id: userId,
          updated_at: new Date(),
        },
        select: {
          metric_key: true,
          academic_year: true,
          target_value: true,
          updated_at: true,
        },
      });
      this.logger.log(
        'Scorecard target set: ' +
          metricKey +
          '=' +
          targetValue +
          ' for ' +
          academicYear +
          ' by user=' +
          userId,
      );
      return {
        metric_key: row.metric_key,
        academic_year: row.academic_year,
        target_value: Number(row.target_value),
        updated_at: instant(row.updated_at),
      };
    } catch (err) {
      this.logger.error(
        'DB error setting scorecard target ' + metricKey,
        err as Error,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /me/media-reports/app-performance
   *
   * The design's version of this panel showed social-media follower reach,
   * which nothing in this system records. What is real is how far a published
   * post actually travelled inside the app, so "reach" is the number of
   * distinct accounts notified about posts of each format — a genuine count
   * from the notifications table — over the last 30 days, with growth measured
   * against the 30 days before that.
   *
   * The formats come from the posts themselves rather than a fixed list, so
   * whatever the publishing tab has actually been used to send is what shows.
   * The panel is a four-tile grid, so the four best-travelled formats are
   * returned, padded with the publishing tab's own options when fewer than
   * four have been used — those pad tiles carry nulls and render as "not
   * enough data yet" instead of implying zero reach.
   */
  async appPerformance() {
    try {
      const rows = await this.prisma.$queryRaw<
        {
          format: string | null;
          posts: bigint;
          reach: bigint;
          prev_reach: bigint;
        }[]
      >`
        SELECT spd.format AS format,
               COUNT(DISTINCT a.id) FILTER (
                 WHERE a.created_at >= NOW() - INTERVAL '30 days'
               ) AS posts,
               COUNT(DISTINCT n.user_id) FILTER (
                 WHERE a.created_at >= NOW() - INTERVAL '30 days'
               ) AS reach,
               COUNT(DISTINCT n.user_id) FILTER (
                 WHERE a.created_at >= NOW() - INTERVAL '60 days'
                   AND a.created_at <  NOW() - INTERVAL '30 days'
               ) AS prev_reach
        FROM social_post_details spd
        JOIN announcements a ON a.id = spd.announcement_id
        LEFT JOIN notifications n
               ON n.related_entity_type = 'announcement'
              AND n.related_entity_id = a.id
        WHERE a.created_at >= NOW() - INTERVAL '60 days'
        GROUP BY spd.format
        ORDER BY 3 DESC, 1 ASC
      `;

      const channels: {
        key: string;
        name: string;
        posts: number | null;
        reach: number | null;
        growth_pct: number | null;
      }[] = rows
        .filter((r) => Number(r.posts) > 0)
        .slice(0, 4)
        .map((r) => {
          const label = r.format ?? 'Unspecified';
          const reach = Number(r.reach);
          const prevReach = Number(r.prev_reach);
          return {
            key: slug(label),
            name: titleCase(label),
            posts: Number(r.posts),
            reach,
            // With no comparable previous window there is no growth figure to
            // state, rather than an implied +100%.
            growth_pct:
              prevReach > 0
                ? Math.round(((reach - prevReach) / prevReach) * 1000) / 10
                : null,
          };
        });

      const used = new Set(channels.map((c) => c.key));
      for (const name of SOCIAL_FORMATS) {
        if (channels.length >= 4) break;
        if (used.has(slug(name))) continue;
        channels.push({
          key: slug(name),
          name,
          posts: null,
          reach: null,
          growth_pct: null,
        });
      }

      return { channels };
    } catch (err) {
      this.logger.error('DB error building app performance', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
