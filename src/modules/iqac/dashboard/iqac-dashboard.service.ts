import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PrincipalDashboardService } from 'src/modules/principal/dashboard/dashboard.service';
import { PrincipalPlacementsService } from 'src/modules/principal/placements/placements.service';
import { PrincipalHigherEducationService } from 'src/modules/principal/higher-education/higher-education.service';

@Injectable()
export class IqacDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: PrincipalDashboardService,
    private readonly placements: PrincipalPlacementsService,
    private readonly higherEducation: PrincipalHigherEducationService,
  ) {}

  /**
   * GET /me/iqac/dashboard
   *
   * The reference design's "Institution at a glance" has 13 KPIs. 12 are
   * real here, reusing the exact same services Principal/Placements/
   * Higher-education already expose (not re-derived) plus a few direct
   * counts (courses, department_mous, department_research_funding,
   * faculty_patents) that are simple enough not to warrant their own
   * service. "Student/Faculty Satisfaction" stay null — no aggregate
   * satisfaction score exists anywhere in the schema (a mean
   * feedback_responses rating would be a guess at what "satisfaction"
   * means, not a read of a real tracked figure; feedback_faculty_responses
   * is students rating faculty, not faculty's own satisfaction).
   */
  async overview() {
    const [
      principalSummary,
      insights,
      placementSummary,
      higherEducationSummary,
      coursesTotal,
      publicationsTotal,
      mousTotal,
      fundedProjects,
      patentsTotal,
    ] = await Promise.all([
      this.dashboard.summary(),
      this.dashboard.insights(),
      this.placements.summary(),
      this.higherEducation.summary(),
      this.prisma.courses.count(),
      this.prisma.faculty_publications.count(),
      this.prisma.department_mous.count(),
      this.prisma.department_research_funding.findMany({
        select: { sanctioned_amount: true },
      }),
      this.prisma.faculty_patents.count(),
    ]);

    const studentsTotal = principalSummary.students.total_active;
    const facultyTotal = principalSummary.faculty.total_active;
    const fundedTotal = fundedProjects.reduce(
      (sum, p) =>
        sum + (p.sanctioned_amount != null ? Number(p.sanctioned_amount) : 0),
      0,
    );

    return {
      students_total: studentsTotal,
      faculty_total: facultyTotal,
      departments_total: principalSummary.departments.total,
      programmes_total: coursesTotal,
      student_faculty_ratio:
        facultyTotal > 0 ? Math.round(studentsTotal / facultyTotal) : null,
      placement_percentage: placementSummary.overall.percentage,
      placed_count: placementSummary.overall.placed,
      higher_studies_count: higherEducationSummary.total,
      higher_studies_percentage:
        studentsTotal > 0
          ? Math.round((higherEducationSummary.total / studentsTotal) * 1000) /
            10
          : null,
      publications_total: publicationsTotal,
      patents_total: patentsTotal,
      funded_projects_count: fundedProjects.length,
      funded_projects_amount: fundedTotal,
      mous_total: mousTotal,
      student_satisfaction: null,
      faculty_satisfaction: null,
      attention_flags: insights.attention_flags,
    };
  }
}
