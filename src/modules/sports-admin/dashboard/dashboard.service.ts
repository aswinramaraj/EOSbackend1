import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { INTERNAL_ERROR, formatHHMM } from '../common/sports-common';
import type { DashboardTimeframe } from './dto/get-dashboard-query.dto';

/**
 * `session_date`/`fixture_date` are `@db.Date` columns — timezone-naive
 * calendar dates, stored and compared as UTC midnight. Building "today"
 * with `new Date(year, month, day)` (the local-timezone constructor) was a
 * real bug on any server not running in UTC: on this box (IST, UTC+5:30)
 * local midnight is 18:30 UTC the *previous* day, so every "today" query
 * below was silently reading yesterday's rows instead. Reading the local
 * calendar components (so "today" still means today, here) and then
 * anchoring them at `Date.UTC(...)` gives the correct boundary regardless
 * of the server's timezone.
 */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}
function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function minutesBetween(start: Date | null, end: Date | null): number {
  if (!start || !end) return 60;
  const s = start.getHours() * 60 + start.getMinutes();
  const e = end.getHours() * 60 + end.getMinutes();
  return Math.max(0, e - s) || 60;
}
function daysAgo(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 86_400_000);
}

/**
 * Dashboard KPIs are honest computations from the real tables below, not a
 * literal re-creation of the design reference's placeholder numbers — same
 * "real signal, not the exact original semantic" approach the Student
 * module's dashboard already takes for its own KPI cards.
 */
@Injectable()
export class SportsDashboardService {
  private readonly logger = new Logger(SportsDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/dashboard?timeframe= */
  async getOverview(timeframe: DashboardTimeframe = 'today') {
    try {
      const today = startOfDay(new Date());
      const todayStr = toDateOnly(today);
      // .getFullYear() here is a *local* getter reading back a UTC-midnight
      // instant — safe (rounds back to the same calendar year it was built
      // from, see startOfDay's comment) — but the Jan-1 boundary itself
      // still needs the same Date.UTC anchoring, not the local constructor.
      const yearStart = new Date(Date.UTC(today.getFullYear(), 0, 1));
      const in7Days = new Date(today.getTime() + 7 * 86_400_000);

      // Achievements and "coaches" card both read a different real window
      // per tab — this is the one place the tabs actually change what's
      // computed, not just relabel the same numbers (see dashboard.
      // frontend's KPI card notes for why athletes/equipment don't vary).
      const windowStart =
        timeframe === 'year'
          ? yearStart
          : timeframe === 'term'
            ? daysAgo(today, 180)
            : daysAgo(today, 7);

      const [
        athleteTotal,
        athleteActive,
        disciplineActiveCount,
        coachTotal,
        coachOnDuty,
        achievementsInWindow,
        achievementsStrong,
        equipmentTypes,
        equipmentTotalUnitsAgg,
        equipmentIssued,
        pendingTrials,
        pendingBudget,
        pendingOd,
        openInjuries,
        pendingFixtures,
        sessionsInWindow,
        cancelledInWindow,
        todaysSessionsRaw,
        upcomingFixturesRaw,
        recentAchievementsRaw,
        recentAnnouncementsRaw,
        facilitiesRaw,
        sessionsTodayForUsage,
        fixturesTodayForUsage,
      ] = await Promise.all([
        this.prisma.sports_athlete_profiles.count(),
        this.prisma.sports_athlete_profiles.count({
          where: { status: 'active' },
        }),
        this.prisma.sports_disciplines.count({ where: { is_active: true } }),
        this.prisma.sports_coach_profiles.count(),
        this.prisma.sports_coach_profiles.count({
          where: { duty_status: 'on_duty' },
        }),
        this.prisma.sports_achievements.count({
          where: { achievement_date: { gte: windowStart } },
        }),
        this.prisma.sports_achievements.count({
          where: {
            achievement_date: { gte: windowStart },
            result: { contains: 'gold', mode: 'insensitive' },
          },
        }),
        this.prisma.sports_equipment.count(),
        this.prisma.sports_equipment.aggregate({
          _sum: { total_quantity: true },
        }),
        this.prisma.sports_equipment_issues.count({
          where: { status: { in: ['borrowed', 'overdue'] } },
        }),
        this.prisma.sports_trials.count({ where: { status: 'pending' } }),
        this.prisma.sports_budget_requests.count({
          where: { status: 'pending' },
        }),
        this.prisma.sports_od_requests.count({ where: { status: 'pending' } }),
        this.prisma.sports_injuries.count({ where: { status: 'open' } }),
        this.prisma.sports_fixtures.count({ where: { status: 'pending' } }),
        this.prisma.sports_training_sessions.count({
          where: { session_date: { gte: windowStart, lte: today } },
        }),
        this.prisma.sports_training_sessions.count({
          where: {
            session_date: { gte: windowStart, lte: today },
            status: 'cancelled',
          },
        }),
        this.prisma.sports_training_sessions.findMany({
          where: { session_date: today },
          include: {
            sports_disciplines: { select: { id: true, name: true } },
            sports_facilities: { select: { id: true, name: true } },
            faculty: {
              select: { id: true, first_name: true, last_name: true },
            },
          },
          orderBy: { start_time: 'asc' },
        }),
        this.prisma.sports_fixtures.findMany({
          where: { fixture_date: { gte: today, lte: in7Days } },
          include: {
            sports_disciplines: { select: { id: true, name: true } },
            sports_facilities: { select: { id: true, name: true } },
          },
          orderBy: { fixture_date: 'asc' },
          take: 5,
        }),
        this.prisma.sports_achievements.findMany({
          orderBy: { achievement_date: 'desc' },
          take: 5,
          include: { sports_teams: { select: { name: true } } },
        }),
        this.prisma.sports_announcements.findMany({
          orderBy: { created_at: 'desc' },
          take: 3,
        }),
        this.prisma.sports_facilities.findMany(),
        this.prisma.sports_training_sessions.findMany({
          where: { session_date: today },
          select: { facility_id: true, start_time: true, end_time: true },
        }),
        this.prisma.sports_fixtures.findMany({
          where: { fixture_date: today },
          select: { facility_id: true },
        }),
      ]);

      const usageByFacility = new Map<number, number>();
      for (const s of sessionsTodayForUsage) {
        if (!s.facility_id) continue;
        usageByFacility.set(
          s.facility_id,
          (usageByFacility.get(s.facility_id) ?? 0) +
            minutesBetween(s.start_time, s.end_time),
        );
      }
      for (const f of fixturesTodayForUsage) {
        if (!f.facility_id) continue;
        usageByFacility.set(
          f.facility_id,
          (usageByFacility.get(f.facility_id) ?? 0) + 180,
        );
      }
      const facilityUse = facilitiesRaw
        .map((f) => ({
          id: f.id,
          name: f.name,
          usage_pct: Math.min(
            100,
            Math.round(((usageByFacility.get(f.id) ?? 0) / 720) * 100),
          ),
        }))
        .sort((a, b) => b.usage_pct - a.usage_pct)
        .slice(0, 6);

      const flags: { title: string; sub: string; route: string }[] = [];
      if (pendingTrials > 0)
        flags.push({
          title: `${pendingTrials} trial${pendingTrials > 1 ? 's' : ''} awaiting a decision`,
          sub: 'Selection panel has not recorded an outcome yet',
          route: 'trials',
        });
      if (pendingBudget > 0)
        flags.push({
          title: `${pendingBudget} budget request${pendingBudget > 1 ? 's' : ''} pending`,
          sub: 'Waiting on the sports office to approve or reject',
          route: 'budget',
        });
      if (pendingOd > 0)
        flags.push({
          title: `${pendingOd} on-duty request${pendingOd > 1 ? 's' : ''} awaiting the Principal`,
          sub: 'Squad travel not yet confirmed',
          route: 'od',
        });
      if (openInjuries > 0)
        flags.push({
          title: `${openInjuries} open injury or incident case${openInjuries > 1 ? 's' : ''}`,
          sub: 'Return-to-play not yet cleared',
          route: 'injuries',
        });

      const windowLabel =
        timeframe === 'year'
          ? 'this year'
          : timeframe === 'term'
            ? 'this term'
            : 'this week';

      return {
        date: todayStr,
        timeframe,
        pending_fixtures_count: pendingFixtures,
        kpis: {
          athletes: {
            value: athleteTotal,
            strong: athleteActive,
            foot: `across ${disciplineActiveCount} active discipline${disciplineActiveCount === 1 ? '' : 's'}`,
          },
          // "Coaches on duty" only means something as a point-in-time fact —
          // for the term/year tabs it's swapped for sessions actually held
          // in that window (a real, differently-windowed number) rather
          // than relabelling the same on-duty ratio.
          coaches:
            timeframe === 'today'
              ? {
                  value: coachTotal,
                  on_duty: coachOnDuty,
                  foot: `${coachTotal - coachOnDuty} on leave`,
                }
              : {
                  value: sessionsInWindow,
                  on_duty: cancelledInWindow,
                  foot: `${cancelledInWindow} cancelled or reassigned`,
                },
          achievements: {
            value: achievementsInWindow,
            strong: achievementsStrong,
            foot: `first places or golds ${windowLabel}`,
          },
          equipment: {
            value: equipmentTotalUnitsAgg._sum.total_quantity ?? 0,
            strong: equipmentIssued,
            foot: `issued and not returned · ${equipmentTypes} type${equipmentTypes === 1 ? '' : 's'}`,
          },
        },
        flags,
        todays_sessions: todaysSessionsRaw.map((s) => ({
          id: s.id,
          title: s.sports_disciplines.name,
          sub: [
            s.sports_facilities?.name,
            s.faculty ? `${s.faculty.first_name} ${s.faculty.last_name}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          start_time: formatHHMM(s.start_time),
          status: s.status,
        })),
        upcoming_fixtures: upcomingFixturesRaw.map((f) => ({
          id: f.id,
          title: f.title,
          sub: [f.opponent, f.sports_facilities?.name]
            .filter(Boolean)
            .join(' · '),
          fixture_date: toDateOnly(f.fixture_date),
          status: f.status,
        })),
        facility_use: facilityUse,
        recent_achievements: recentAchievementsRaw.map((a) => ({
          id: a.id,
          title: a.event_name,
          sub: [a.participant_name ?? a.sports_teams?.name, a.venue]
            .filter(Boolean)
            .join(' · '),
          badge: a.result,
        })),
        announcements: recentAnnouncementsRaw.map((n) => ({
          id: n.id,
          title: n.title,
          category: n.category,
          created_at: n.created_at,
        })),
      };
    } catch (err) {
      this.logger.error(
        'DB error while computing sports-admin dashboard overview',
        err,
      );
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
