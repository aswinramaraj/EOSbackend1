import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListEdcQueryDto } from './dto/list-edc-query.dto';

const REGISTRATION_TYPE_LABELS: Record<string, string> = {
  private_limited: 'Pvt Ltd',
  llp: 'LLP',
  proprietorship: 'Proprietorship',
  unregistered: 'Unregistered',
};

@Injectable()
export class PrincipalEdcService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /me/principal/edc/filters — real batches/departments only. */
  async filters() {
    const [batches, departments] = await Promise.all([
      this.prisma.batches.findMany({
        select: { id: true, name: true },
        orderBy: { start_year: 'desc' },
      }),
      this.prisma.departments.findMany({
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { batches, departments };
  }

  /**
   * GET /me/principal/edc/summary
   *
   * "Startups" (beyond idea stage) is a judgment call over the real
   * free-text `stage` column: a null/empty stage or literally "idea"
   * (case-insensitive) counts as idea-stage, anything else on file counts
   * as having progressed.
   *
   * "Incubated" now comes from the real `incubations` 1:1 relation (a
   * dedicated table with its own real `status` field, default 'Active')
   * rather than the plain `is_incubated` boolean — the relation is the
   * richer, more specific source of truth. "Active" = incubations where
   * status is literally 'Active' (freeform text column, so other real
   * values could appear later; never assumed to be the only one).
   */
  async summary() {
    const rows = await this.prisma.student_entrepreneurship.findMany({
      select: {
        id: true,
        stage: true,
        registration_type: true,
        incubations: { select: { status: true } },
      },
    });
    const beyondIdea = rows.filter((r) => {
      const stage = r.stage?.trim().toLowerCase();
      return !!stage && stage !== 'idea';
    }).length;

    const registeredVenturesCount = rows.filter(
      (r) =>
        r.registration_type != null && r.registration_type !== 'unregistered',
    ).length;
    const incubatedCount = rows.filter((r) => r.incubations != null).length;
    const activeCount = rows.filter(
      (r) => r.incubations?.status === 'Active',
    ).length;

    return {
      students_in_edc: rows.length,
      startups_beyond_idea: beyondIdea,
      registered_ventures_count: registeredVenturesCount,
      incubated_count: incubatedCount,
      active_count: activeCount,
    };
  }

  /**
   * GET /me/principal/edc
   *
   * Only 1 real row exists today — fetches everything matching the filters,
   * no server pagination, same tradeoff as Students/Faculty/Higher
   * Education. `registration_type`/`is_incubated`/`role` are real once
   * query.md #5 is run — until then all null.
   */
  async list(query: ListEdcQueryDto) {
    const rows = await this.prisma.student_entrepreneurship.findMany({
      select: {
        id: true,
        business_name: true,
        business_description: true,
        sector: true,
        stage: true,
        funding_required: true,
        remarks: true,
        registration_type: true,
        is_incubated: true,
        role: true,
        incubations: { select: { status: true } },
        students: {
          select: {
            id: true,
            register_no: true,
            batches: { select: { id: true, name: true } },
            classes: {
              select: {
                departments: { select: { id: true, name: true, code: true } },
              },
            },
            courses: {
              select: {
                departments: { select: { id: true, name: true, code: true } },
              },
            },
            users: { select: { email: true } },
            soa_applications: {
              select: { first_name: true, last_name: true },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
    });

    const records = rows
      .map((row) => {
        const student = row.students;
        const department =
          student.classes?.departments ?? student.courses?.departments ?? null;
        const name =
          student.soa_applications?.first_name ||
          student.soa_applications?.last_name
            ? [
                student.soa_applications?.first_name,
                student.soa_applications?.last_name,
              ]
                .filter(Boolean)
                .join(' ')
            : student.users.email;

        return {
          id: row.id,
          student: { id: student.id, name, register_no: student.register_no },
          batch: student.batches,
          department,
          venture: row.business_name,
          description: row.business_description,
          domain: row.sector,
          stage: row.stage,
          registration_type: row.registration_type,
          is_incubated: row.is_incubated,
          incubation_status: row.incubations?.status ?? null,
          role: row.role,
          funding_required:
            row.funding_required != null ? Number(row.funding_required) : null,
          remarks: row.remarks,
        };
      })
      .filter((r) => {
        if (query.batch_id && r.batch?.id !== query.batch_id) return false;
        if (query.department_id && r.department?.id !== query.department_id)
          return false;
        if (query.status && r.incubation_status !== query.status) return false;
        if (query.q) {
          const q = query.q.toLowerCase();
          const haystack = [
            r.student.name,
            r.student.register_no,
            r.venture,
            r.domain,
            r.stage,
            r.department?.name,
            r.department?.code,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });

    return { total: records.length, records };
  }

  /**
   * GET /me/principal/edc/:id/profile — full EDC Student Profile detail
   * screen. Every field maps to a real column on `student_entrepreneurship`
   * itself, the originating `startup_ideas` row (for "Solution / product" —
   * ideas link to the venture they became via startup_ideas.
   * converted_venture_id, not the other way round), or the same real
   * family/contact data the Student Profile screen already uses.
   * A total-headcount "employees" figure from the reference design has no
   * backing anywhere in the schema (only `team_size`, the founding-team
   * count, is real) so it's left out rather than fabricated.
   */
  async getProfile(id: number) {
    const row = await this.prisma.student_entrepreneurship.findUnique({
      where: { id },
      select: {
        id: true,
        business_name: true,
        business_description: true,
        sector: true,
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
        funding_required: true,
        funding_received: true,
        funding_source: true,
        govt_grant_scheme: true,
        incubator_support: true,
        accelerator_support: true,
        venture_logo_url: true,
        stage: true,
        registration_type: true,
        is_incubated: true,
        role: true,
        year_started: true,
        current_status_note: true,
        remarks: true,
        faculty: { select: { first_name: true, last_name: true } },
        incubations: { select: { status: true } },
        students: {
          select: {
            id: true,
            register_no: true,
            roll_no: true,
            photo_url: true,
            batches: { select: { id: true, name: true } },
            classes: {
              select: {
                section: true,
                current_semester: true,
                departments: { select: { id: true, name: true, code: true } },
              },
            },
            courses: {
              select: { name: true, departments: { select: { id: true, name: true, code: true } } },
            },
            users: { select: { email: true } },
            soa_applications: { select: { first_name: true, last_name: true } },
            student_contacts: { select: { student_mobile: true } },
            student_family_details: true,
          },
        },
      },
    });

    if (!row) {
      throw new InternalServerErrorException({
        message: 'EDC record not found',
        errorCode: 'EDC_RECORD_NOT_FOUND',
      });
    }

    // The idea that became this venture, if any — startup_ideas points at
    // the venture via converted_venture_id, not the other way round.
    const originatingIdea = await this.prisma.startup_ideas.findFirst({
      where: { converted_venture_id: id },
      select: { solution: true },
    });

    const student = row.students;
    const department = student.classes?.departments ?? student.courses?.departments ?? null;
    const semester = student.classes?.current_semester ?? null;
    const family = student.student_family_details;
    const studentName =
      student.soa_applications?.first_name || student.soa_applications?.last_name
        ? [student.soa_applications?.first_name, student.soa_applications?.last_name].filter(Boolean).join(' ')
        : student.users.email;

    return {
      id: row.id,
      student: {
        id: student.id,
        name: studentName,
        register_no: student.register_no,
        roll_no: student.roll_no,
        photo_url: student.photo_url,
        institute_email: student.users.email,
        mobile: student.student_contacts?.student_mobile ?? null,
      },
      batch: student.batches,
      department,
      programme: student.courses?.name ?? null,
      section: student.classes?.section ?? null,
      year: semester != null ? Math.ceil(semester / 2) : null,
      venture_name: row.business_name,
      venture_logo_url: row.venture_logo_url,
      description: row.business_description,
      sector: row.sector,
      business_category: row.business_category,
      problem_statement: row.problem_statement,
      solution: originatingIdea?.solution ?? null,
      location: row.location,
      business_model: row.business_model,
      target_customers: row.target_customers,
      website: row.website,
      linkedin_url: row.linkedin_url,
      co_founders: row.co_founders,
      team_size: row.team_size,
      student_team_note: row.student_team_note,
      faculty_mentor: row.faculty ? `${row.faculty.first_name} ${row.faculty.last_name}` : null,
      external_mentor_name: row.external_mentor_name,
      external_mentor_org: row.external_mentor_org,
      team_roles_note: row.team_roles_note,
      idea_developed: row.idea_developed,
      prototype_developed: row.prototype_developed,
      mvp_launched: row.mvp_launched,
      product_launched: row.product_launched,
      customers_count: row.customers_count,
      monthly_revenue: row.monthly_revenue ? Number(row.monthly_revenue) : null,
      growth_stage: row.growth_stage,
      funding_status: row.funding_status,
      funding_required: row.funding_required ? Number(row.funding_required) : null,
      funding_received: row.funding_received ? Number(row.funding_received) : null,
      funding_source: row.funding_source,
      govt_grant_scheme: row.govt_grant_scheme,
      incubator_support: row.incubator_support,
      accelerator_support: row.accelerator_support,
      stage: row.stage,
      registration_type: row.registration_type,
      registration_label: row.registration_type
        ? REGISTRATION_TYPE_LABELS[row.registration_type] ?? row.registration_type
        : null,
      is_registered: !!row.registration_type && row.registration_type !== 'unregistered',
      is_incubated: row.is_incubated,
      incubation_status: row.incubations?.status ?? null,
      role: row.role,
      year_started: row.year_started,
      current_status_note: row.current_status_note,
      remarks: row.remarks,
      family: family
        ? {
            father: {
              name: family.father_name,
              occupation: family.father_occupation,
              mobile: family.father_mobile,
              email: family.father_email,
              photo_url: family.father_photo_url,
            },
            mother: {
              name: family.mother_name,
              occupation: family.mother_occupation,
              mobile: family.mother_mobile,
              email: family.mother_email,
              photo_url: family.mother_photo_url,
            },
            guardian: family.guardian_name
              ? {
                  name: family.guardian_name,
                  relationship: family.guardian_relationship,
                  is_father: false,
                  mobile: family.guardian_phone,
                  email: family.guardian_email,
                }
              : {
                  name: family.father_name,
                  relationship: 'Father',
                  is_father: true,
                  mobile: family.father_mobile,
                  email: family.father_email,
                },
          }
        : null,
    };
  }
}
