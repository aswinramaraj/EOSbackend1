import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ReportTable } from 'src/modules/library/reports/report-export.util';
import { CreateReportRecordDto } from './dto/create-report-record.dto';

/**
 * EDC Coordinator's "Reports" screen. Every KPI/panel/table row is computed
 * LIVE from the already-real ventures/incubations/startup_ideas tables — no
 * new table needed for the numbers themselves (confirmed via a live DB
 * audit: no aggregate/stats table exists or is needed here). The design's
 * AICTE/NIRF/IIC-specific return formats aren't a real backend concept
 * anywhere in this schema, so this reports the real underlying data
 * (venture/department/funding/incubation counts) rather than fabricating
 * scheme-specific calculations that don't exist. `edc_reports` is a
 * separate small table that only logs WHEN a report was generated/exported
 * — the "Report Library" list — not a cache of the numbers themselves.
 */
export interface EdcReportStats {
  total_ventures: number;
  ventures_beyond_idea: number;
  total_incubated: number;
  idea_conversion_rate_pct: number;
  departments_active: number;
  monthly_revenue_reported: number;
  department_breakdown: { department: string; count: number }[];
}

@Injectable()
export class EdcReportsService {
  private readonly logger = new Logger(EdcReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Live KPI tiles for the Reports dashboard. */
  async stats(): Promise<EdcReportStats> {
    const [ventures, incubations, ideas] = await Promise.all([
      this.prisma.student_entrepreneurship.findMany({
        select: {
          id: true,
          registration_type: true,
          idea_developed: true,
          prototype_developed: true,
          mvp_launched: true,
          product_launched: true,
          monthly_revenue: true,
          students: { select: { classes: { select: { departments: { select: { name: true } } } } } },
        },
      }),
      this.prisma.incubations.count(),
      this.prisma.startup_ideas.findMany({ select: { review_status: true, converted_venture_id: true } }),
    ]);

    const beyondIdea = ventures.filter((v) => v.prototype_developed || v.mvp_launched || v.product_launched).length;
    const convertedIdeas = ideas.filter((i) => i.converted_venture_id !== null).length;
    const conversionRate = ideas.length ? Math.round((convertedIdeas / ideas.length) * 100) : 0;
    const totalRevenue = ventures.reduce((sum, v) => sum + (v.monthly_revenue !== null ? Number(v.monthly_revenue) : 0), 0);

    const deptCounts = new Map<string, number>();
    for (const v of ventures) {
      const dept = v.students.classes?.departments?.name ?? 'Unassigned';
      deptCounts.set(dept, (deptCounts.get(dept) ?? 0) + 1);
    }

    return {
      total_ventures: ventures.length,
      ventures_beyond_idea: beyondIdea,
      total_incubated: incubations,
      idea_conversion_rate_pct: conversionRate,
      departments_active: [...deptCounts.keys()].filter((d) => d !== 'Unassigned').length,
      monthly_revenue_reported: totalRevenue,
      department_breakdown: [...deptCounts.entries()].map(([department, count]) => ({ department, count })).sort((a, b) => b.count - a.count),
    };
  }

  /** The exportable table itself — one row per real venture. */
  async ventureTable(): Promise<ReportTable> {
    try {
      const rows = await this.prisma.student_entrepreneurship.findMany({
        include: {
          students: {
            select: {
              student_id_no: true,
              soa_applications: { select: { first_name: true, last_name: true } },
              users: { select: { email: true } },
              classes: { select: { departments: { select: { name: true }} } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      return {
        title: 'EDC Venture Report',
        columns: [
          { header: 'Venture', key: 'venture', width: 28 },
          { header: 'Founder', key: 'founder', width: 24 },
          { header: 'Department', key: 'department', width: 22 },
          { header: 'Stage', key: 'stage', width: 16 },
          { header: 'Registration', key: 'registration', width: 18 },
          { header: 'Funding Received', key: 'funding', width: 18 },
          { header: 'Registered On', key: 'registered_on', width: 16 },
        ],
        rows: rows.map((r) => ({
          venture: r.business_name,
          founder: r.students.soa_applications
            ? `${r.students.soa_applications.first_name} ${r.students.soa_applications.last_name ?? ''}`.trim()
            : r.students.users.email,
          department: r.students.classes?.departments?.name ?? '—',
          stage: r.stage ?? '—',
          registration: r.registration_type ?? 'Unregistered',
          funding: r.funding_received !== null ? `₹${Number(r.funding_received).toLocaleString('en-IN')}` : '—',
          registered_on: r.created_at.toISOString().slice(0, 10),
        })),
      };
    } catch (err) {
      this.logger.error('DB error building EDC venture report table', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async listLibrary() {
    const rows = await this.prisma.edc_reports.findMany({
      include: { users: { select: { email: true } } },
      orderBy: { generated_at: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      report_name: r.report_name,
      period_label: r.period_label,
      prepared_by_email: r.users?.email ?? null,
      status: r.status,
      generated_at: r.generated_at,
    }));
  }

  /** Logs a Report Library row right after a real export succeeds. */
  async logGenerated(dto: CreateReportRecordDto, preparedByUserId: number) {
    const created = await this.prisma.edc_reports.create({
      data: {
        report_name: dto.report_name,
        period_label: dto.period_label,
        prepared_by_user_id: preparedByUserId,
        status: 'Verified',
      },
      include: { users: { select: { email: true } } },
    });
    return {
      id: created.id,
      report_name: created.report_name,
      period_label: created.period_label,
      prepared_by_email: created.users?.email ?? null,
      status: created.status,
      generated_at: created.generated_at,
    };
  }
}
