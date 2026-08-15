import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { CreateTestDto } from './dto/create-test.dto';

interface TestScoreRow {
  student_id: number;
  test_name: string;
  score: string;
  test_date: Date | null;
  student_name: string;
}

interface TestRegisterRow {
  test_name: string;
  enrolled_count: number;
  cleared_count: number;
  next_window_label: string | null;
  next_window_date: Date | null;
  readiness: string;
}

interface CoachingBatchRow {
  batch_name: string;
  detail: string;
}

interface WatchlistRow {
  label: string;
  count: number;
}

/**
 * Test readiness for the Higher Education Cell — merges two real sources:
 * `student_test_scores` (generic, pre-existing) gives "attempted" (a
 * distinct-student count of who actually has a recorded score) and mean/
 * high/low, all genuinely derived. `higher_education_test_register` (new)
 * carries what nothing else tracks: enrolled-for-coaching counts (a bigger,
 * separate number from who sat the test), a cutoff-based cleared count,
 * the next test window, and the coordinator's own readiness call — the
 * same fields the design's "Add test" form writes. Coaching batches and
 * the retake watchlist are separate small real tables with no write UI
 * yet (the Add-test form has no fields for them).
 */
@Injectable()
export class HigherEducationTestReadinessService {
  private readonly logger = new Logger(HigherEducationTestReadinessService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getTestReadiness() {
    try {
      const rows = await this.prisma.$queryRaw<TestScoreRow[]>(Prisma.sql`
        SELECT
          sts.student_id, sts.test_name, sts.score::text AS score, sts.test_date,
          COALESCE(NULLIF(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))), ''), u.email) AS student_name
        FROM student_test_scores sts
        JOIN students s ON s.id = sts.student_id
        JOIN users u ON u.id = s.user_id
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        WHERE sts.student_id IN (SELECT student_id FROM student_higher_education)
        ORDER BY sts.test_date DESC NULLS LAST
      `);

      const totalAspirants = await this.prisma.student_higher_education.count();
      const aspirantsWithScores = new Set(rows.map((r) => r.student_id)).size;

      const byTest = new Map<string, TestScoreRow[]>();
      for (const r of rows) {
        const list = byTest.get(r.test_name) ?? [];
        list.push(r);
        byTest.set(r.test_name, list);
      }

      const registerRows = await this.prisma.$queryRaw<TestRegisterRow[]>(Prisma.sql`
        SELECT test_name, enrolled_count, cleared_count, next_window_label, next_window_date, readiness
        FROM higher_education_test_register
      `);
      const registerByName = new Map(registerRows.map((r) => [r.test_name, r]));
      const allTestNames = new Set([...byTest.keys(), ...registerByName.keys()]);

      const tests = Array.from(allTestNames)
        .map((testName) => {
          const group = byTest.get(testName) ?? [];
          const scores = group.map((g) => Number(g.score));
          const register = registerByName.get(testName);
          return {
            testName,
            enrolled: register?.enrolled_count ?? null,
            attempted: group.length,
            cleared: register?.cleared_count ?? null,
            meanScore: scores.length > 0 ? Math.round((scores.reduce((sum, v) => sum + v, 0) / scores.length) * 10) / 10 : null,
            nextWindow: register?.next_window_label ?? null,
            nextWindowDate: register?.next_window_date ? register.next_window_date.toISOString().slice(0, 10) : null,
            readiness: register?.readiness ?? null,
          };
        })
        .sort((a, b) => (b.enrolled ?? b.attempted) - (a.enrolled ?? a.attempted));

      const upcoming = tests
        .filter((t) => t.nextWindowDate != null)
        .sort((a, b) => a.nextWindowDate!.localeCompare(b.nextWindowDate!));

      const coachingBatches = await this.prisma.$queryRaw<CoachingBatchRow[]>(Prisma.sql`
        SELECT batch_name, detail FROM higher_education_coaching_batches ORDER BY id ASC
      `);
      const retakeWatchlist = await this.prisma.$queryRaw<WatchlistRow[]>(Prisma.sql`
        SELECT label, count FROM higher_education_retake_watchlist ORDER BY id ASC
      `);

      return {
        summary: { totalRecords: rows.length, distinctTests: allTestNames.size, aspirantsWithScores, totalAspirants },
        tests,
        upcoming: upcoming.map((t) => ({ testName: t.testName, window: t.nextWindow ?? t.nextWindowDate! })),
        coachingBatches,
        retakeWatchlist,
      };
    } catch (err) {
      this.logger.error('DB error building higher-education test readiness view', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async createTest(dto: CreateTestDto) {
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO higher_education_test_register (test_name, enrolled_count, cleared_count, next_window_label, next_window_date, readiness)
        VALUES (
          ${dto.test_name},
          ${dto.enrolled_count ?? 0},
          ${dto.cleared_count ?? 0},
          ${dto.next_window_label ?? null},
          ${dto.next_window_date ?? null},
          ${dto.readiness ?? 'on_track'}
        )
        ON CONFLICT (test_name) DO UPDATE SET
          enrolled_count = EXCLUDED.enrolled_count,
          cleared_count = EXCLUDED.cleared_count,
          next_window_label = EXCLUDED.next_window_label,
          next_window_date = EXCLUDED.next_window_date,
          readiness = EXCLUDED.readiness
      `);
      return { testName: dto.test_name };
    } catch (err) {
      this.logger.error('DB error saving test register entry', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
