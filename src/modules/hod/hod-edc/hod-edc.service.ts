import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number | null): string | null {
  if (semester == null) return null;
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

function studentName(
  soa: { first_name: string; last_name: string | null } | null,
  email: string,
): string {
  if (!soa) return email;
  return (
    [soa.first_name, soa.last_name].filter(Boolean).join(' ').trim() || email
  );
}

function isBeyondIdeaStage(stage: string | null): boolean {
  return !!stage && stage.trim().toLowerCase() !== 'idea stage';
}

const REGISTRATION_TYPE_LABEL: Record<string, string> = {
  private_limited: 'Private Limited',
  llp: 'LLP',
  proprietorship: 'Proprietorship',
  unregistered: 'Unregistered',
};

function isRegistered(registrationType: string | null): boolean {
  return !!registrationType && registrationType !== 'unregistered';
}

function facultyFullName(f: {
  prefix: string | null;
  first_name: string;
  last_name: string | null;
}): string {
  return [f.prefix, f.first_name, f.last_name].filter(Boolean).join(' ');
}

@Injectable()
export class HodEdcService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Confirms the caller is a real HOD (same guard every HOD module uses),
   * but — unlike Class Records / Placements / Higher Education — the EDC
   * cell itself is college-wide, not scoped to the caller's own department
   * (see query.md #16): the reference design's own table shows ventures
   * from CSE, AIDS, MECH and ECE all in one HOD's view.
   */
  private async resolveHod(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true, department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  /** GET /hod/edc?search=&batch_id=&department_id= */
  async getRecords(
    userId: number,
    search?: string,
    batchId?: number,
    departmentId?: number,
  ) {
    await this.resolveHod(userId);

    const records = await this.prisma.student_entrepreneurship.findMany({
      where: {
        ...(batchId != null ? { students: { batch_id: batchId } } : {}),
        ...(departmentId != null
          ? { students: { classes: { department_id: departmentId } } }
          : {}),
        ...(search
          ? {
              OR: [
                { business_name: { contains: search, mode: 'insensitive' } },
                { sector: { contains: search, mode: 'insensitive' } },
                { stage: { contains: search, mode: 'insensitive' } },
                {
                  students: {
                    student_id_no: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  students: {
                    soa_applications: {
                      OR: [
                        {
                          first_name: { contains: search, mode: 'insensitive' },
                        },
                        {
                          last_name: { contains: search, mode: 'insensitive' },
                        },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        business_name: true,
        sector: true,
        stage: true,
        funding_required: true,
        monthly_revenue: true,
        role: true,
        registration_type: true,
        is_incubated: true,
        students: {
          select: {
            id: true,
            student_id_no: true,
            photo_url: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
            classes: {
              select: {
                departments: { select: { id: true, name: true, code: true } },
                batches: {
                  select: { id: true, start_year: true, end_year: true },
                },
              },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
    });

    const rows = records.map((r) => ({
      id: r.id,
      student_id: r.students.id,
      student_id_no: r.students.student_id_no,
      name: studentName(r.students.soa_applications, r.students.users.email),
      photo_url: r.students.photo_url,
      department_code: r.students.classes?.departments?.code ?? null,
      batch_label: r.students.classes?.batches
        ? `${r.students.classes.batches.start_year}-${r.students.classes.batches.end_year}`
        : null,
      venture: r.business_name,
      domain: r.sector,
      role: r.role,
      monthly_revenue: r.monthly_revenue != null ? Number(r.monthly_revenue) : null,
      stage: r.stage,
    }));

    const total = rows.length;
    const startupsBeyondIdea = rows.filter((r) =>
      isBeyondIdeaStage(r.stage),
    ).length;
    const registeredVentures = records.filter((r) =>
      isRegistered(r.registration_type),
    ).length;
    const privateLimitedCount = records.filter(
      (r) => r.registration_type === 'private_limited',
    ).length;
    const startupsInsideCollege = records.filter((r) => r.is_incubated).length;

    // Filter option lists — every batch/department that actually has an
    // EDC record, not every batch/department the college has ever run.
    const batchOptions = new Map<number, string>();
    const departmentOptions = new Map<number, { name: string; code: string }>();
    for (const record of records) {
      const batch = record.students.classes?.batches;
      if (batch) batchOptions.set(batch.id, `${batch.start_year}-${batch.end_year}`);
      const dept = record.students.classes?.departments;
      if (dept) departmentOptions.set(dept.id, { name: dept.name, code: dept.code });
    }

    return {
      stats: {
        total,
        startups_beyond_idea: startupsBeyondIdea,
        registered_ventures: registeredVentures,
        private_limited_count: privateLimitedCount,
        startups_inside_college: startupsInsideCollege,
      },
      filters: {
        batches: [...batchOptions.entries()]
          .map(([id, label]) => ({ batch_id: id, label }))
          .sort((a, b) => b.batch_id - a.batch_id),
        departments: [...departmentOptions.entries()]
          .map(([id, d]) => ({ department_id: id, name: d.name, code: d.code }))
          .sort((a, b) => a.code.localeCompare(b.code)),
      },
      rows,
    };
  }

  /** GET /hod/edc/:id */
  async getProfile(userId: number, id: number) {
    await this.resolveHod(userId);

    const record = await this.prisma.student_entrepreneurship.findUnique({
      where: { id },
      select: {
        id: true,
        business_name: true,
        business_description: true,
        sector: true,
        stage: true,
        funding_required: true,
        remarks: true,
        role: true,
        registration_type: true,
        is_incubated: true,
        year_started: true,
        current_status_note: true,
        business_category: true,
        problem_statement: true,
        location: true,
        business_model: true,
        target_customers: true,
        website: true,
        linkedin_url: true,
        co_founders: true,
        team_size: true,
        student_team_note: true,
        external_mentor_name: true,
        external_mentor_org: true,
        team_roles_note: true,
        idea_developed: true,
        prototype_developed: true,
        mvp_launched: true,
        product_launched: true,
        customers_count: true,
        monthly_revenue: true,
        growth_stage: true,
        funding_status: true,
        funding_received: true,
        funding_source: true,
        govt_grant_scheme: true,
        incubator_support: true,
        accelerator_support: true,
        venture_logo_url: true,
        faculty: {
          select: { prefix: true, first_name: true, last_name: true },
        },
        students: {
          select: {
            id: true,
            student_id_no: true,
            photo_url: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
            student_contacts: { select: { student_mobile: true } },
            courses: { select: { name: true } },
            classes: {
              select: {
                section: true,
                current_semester: true,
                departments: { select: { code: true } },
                batches: { select: { start_year: true, end_year: true } },
              },
            },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('EDC record not found');

    const student = record.students;
    const fundingRequired =
      record.funding_required != null ? Number(record.funding_required) : null;

    return {
      id: record.id,
      student: {
        id: student.id,
        name: studentName(student.soa_applications, student.users.email),
        student_id_no: student.student_id_no,
        photo_url: student.photo_url,
        department_code: student.classes?.departments?.code ?? null,
        programme: student.courses?.name ?? null,
        batch_label: student.classes?.batches
          ? `${student.classes.batches.start_year}-${student.classes.batches.end_year}`
          : null,
        year_label: yearLabelForSemester(student.classes?.current_semester ?? null),
        section: student.classes?.section ?? null,
        mobile: student.student_contacts?.student_mobile ?? null,
        email: student.users.email,
      },
      venture: {
        business_name: record.business_name,
        sector: record.sector,
        stage: record.stage,
        entrepreneur_type: record.role,
        funding_status: record.funding_status,
        year_started: record.year_started,
        is_incubated: record.is_incubated ?? false,
        logo_url: record.venture_logo_url,
      },
      stats: {
        customers_count: record.customers_count,
        monthly_revenue:
          record.monthly_revenue != null ? Number(record.monthly_revenue) : null,
        team_size: record.team_size,
        funding_raised:
          record.funding_received != null ? Number(record.funding_received) : null,
      },
      entrepreneurship_status: {
        stage: record.stage,
        entrepreneur_type: record.role,
        year_started: record.year_started,
        current_status_note: record.current_status_note,
        registration_type: record.registration_type
          ? REGISTRATION_TYPE_LABEL[record.registration_type] ?? record.registration_type
          : null,
      },
      business_details: {
        business_name: record.business_name,
        sector: record.sector,
        business_category: record.business_category,
        problem_statement: record.problem_statement,
        location: record.location,
        solution_product: record.business_description,
        business_model: record.business_model,
        target_customers: record.target_customers,
        website: record.website,
        linkedin_url: record.linkedin_url,
      },
      founder_team: {
        founder_name: studentName(student.soa_applications, student.users.email),
        co_founders: record.co_founders,
        team_size: record.team_size,
        student_team_note: record.student_team_note,
        faculty_mentor: record.faculty ? facultyFullName(record.faculty) : null,
        external_mentor_name: record.external_mentor_name,
        external_mentor_org: record.external_mentor_org,
        team_roles_note: record.team_roles_note,
      },
      startup_progress: {
        idea_developed: record.idea_developed,
        prototype_developed: record.prototype_developed,
        mvp_launched: record.mvp_launched,
        product_launched: record.product_launched,
        customers_count: record.customers_count,
        monthly_revenue:
          record.monthly_revenue != null ? Number(record.monthly_revenue) : null,
        team_size: record.team_size,
        growth_stage: record.growth_stage,
      },
      funding: {
        funding_status: record.funding_status,
        funding_required: fundingRequired,
        funding_received:
          record.funding_received != null ? Number(record.funding_received) : null,
        funding_source: record.funding_source,
        govt_grant_scheme: record.govt_grant_scheme,
        incubator_support: record.incubator_support,
        accelerator_support: record.accelerator_support,
      },
      remarks: record.remarks,
    };
  }
}
