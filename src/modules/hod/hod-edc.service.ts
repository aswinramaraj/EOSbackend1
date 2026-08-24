import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

function yearLabel(semester: number | null): string | null {
  if (semester == null) return null;
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? null;
}

/** Same real derivation EDC's own frontend already uses (isBeyondIdeaStage in src/modules/edc/api/entrepreneurship.ts) — not invented here. */
function isBeyondIdeaStage(row: {
  prototype_developed: boolean | null;
  mvp_launched: boolean | null;
  product_launched: boolean | null;
  registration_type: string | null;
}): boolean {
  return Boolean(
    row.prototype_developed ||
    row.mvp_launched ||
    row.product_launched ||
    (row.registration_type && row.registration_type !== 'unregistered'),
  );
}

/**
 * GET /hod/edc(|:id) — department-scoped student entrepreneurship
 * ventures, from the real `student_entrepreneurship` table. Every query
 * sequential (Supabase's session-mode pool caps at 15 connections).
 */
@Injectable()
export class HodEdcService {
  private readonly logger = new Logger(HodEdcService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async resolveDepartmentId(user: JwtPayload): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty.department_id;
  }

  async getOverview(
    user: JwtPayload,
    search?: string,
    batchId?: number,
    otherDepartmentId?: number,
  ) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      // A HOD sees their own department's ventures by default, but the
      // frontend hook exposes a department_id filter too (an EDC-wide
      // cross-department browse) — honor it when given, otherwise scope
      // to the caller's own department.
      const scopeDepartmentId = otherDepartmentId ?? departmentId;

      const ventures = await this.prisma.student_entrepreneurship.findMany({
        where: {
          students: {
            status: 'active',
            classes: {
              department_id: scopeDepartmentId,
              ...(batchId ? { batch_id: batchId } : {}),
            },
            ...(search
              ? {
                  OR: [
                    {
                      student_id_no: {
                        contains: search,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      soa_applications: {
                        first_name: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                    {
                      soa_applications: {
                        last_name: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                  ],
                }
              : {}),
          },
        },
        select: {
          id: true,
          business_name: true,
          sector: true,
          role: true,
          monthly_revenue: true,
          stage: true,
          registration_type: true,
          prototype_developed: true,
          mvp_launched: true,
          product_launched: true,
          students: {
            select: {
              id: true,
              student_id_no: true,
              photo_url: true,
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
              classes: {
                select: {
                  departments: { select: { code: true } },
                  batches: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: { id: 'desc' },
      });

      const departments = await this.prisma.departments.findMany({
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      });
      const batches = await this.prisma.batches.findMany({
        where: { classes: { some: { department_id: scopeDepartmentId } } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      const beyondIdea = ventures.filter(isBeyondIdeaStage).length;
      const registered = ventures.filter(
        (v) =>
          v.registration_type != null && v.registration_type !== 'unregistered',
      ).length;
      const privateLimited = ventures.filter(
        (v) => v.registration_type === 'private_limited',
      ).length;

      return {
        stats: {
          total: ventures.length,
          startups_beyond_idea: beyondIdea,
          registered_ventures: registered,
          private_limited_count: privateLimited,
          // No "inside college" location/campus flag exists anywhere on
          // student_entrepreneurship — location is a free-text field, not a
          // boolean. Honest 0 rather than guessing at a text match.
          startups_inside_college: 0,
        },
        filters: {
          batches: batches.map((b) => ({ batch_id: b.id, label: b.name })),
          departments: departments.map((d) => ({
            department_id: d.id,
            name: d.name,
            code: d.code,
          })),
        },
        rows: ventures.map((v) => ({
          id: v.id,
          student_id: v.students.id,
          student_id_no: v.students.student_id_no,
          name: v.students.soa_applications
            ? `${v.students.soa_applications.first_name} ${v.students.soa_applications.last_name ?? ''}`.trim()
            : '—',
          photo_url: v.students.photo_url,
          department_code: v.students.classes?.departments.code ?? null,
          batch_label: v.students.classes?.batches.name ?? null,
          venture: v.business_name,
          domain: v.sector,
          role: v.role,
          monthly_revenue:
            v.monthly_revenue != null ? Number(v.monthly_revenue) : null,
          stage: v.stage,
        })),
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD EDC overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async getProfile(user: JwtPayload, id: number) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const record = await this.prisma.student_entrepreneurship.findUnique({
        where: { id },
        select: {
          id: true,
          business_name: true,
          sector: true,
          stage: true,
          registration_type: true,
          funding_status: true,
          year_started: true,
          is_incubated: true,
          venture_logo_url: true,
          customers_count: true,
          monthly_revenue: true,
          team_size: true,
          funding_received: true,
          current_status_note: true,
          role: true,
          business_category: true,
          problem_statement: true,
          location: true,
          business_model: true,
          target_customers: true,
          website: true,
          linkedin_url: true,
          co_founders: true,
          student_team_note: true,
          external_mentor_name: true,
          external_mentor_org: true,
          team_roles_note: true,
          idea_developed: true,
          prototype_developed: true,
          mvp_launched: true,
          product_launched: true,
          growth_stage: true,
          funding_required: true,
          funding_source: true,
          govt_grant_scheme: true,
          incubator_support: true,
          accelerator_support: true,
          remarks: true,
          faculty: { select: { first_name: true, last_name: true } },
          students: {
            select: {
              id: true,
              student_id_no: true,
              photo_url: true,
              users: { select: { email: true, phone: true } },
              soa_applications: {
                select: {
                  first_name: true,
                  last_name: true,
                  student_contact: true,
                },
              },
              classes: {
                select: {
                  section: true,
                  current_semester: true,
                  department_id: true,
                  departments: { select: { code: true } },
                  batches: { select: { name: true } },
                  courses: { select: { name: true } },
                },
              },
            },
          },
        },
      });
      if (!record || record.students.classes?.department_id !== departmentId) {
        throw new NotFoundException({
          message: 'Venture not found in your department.',
          errorCode: 'VENTURE_NOT_FOUND',
        });
      }

      const name = record.students.soa_applications
        ? `${record.students.soa_applications.first_name} ${record.students.soa_applications.last_name ?? ''}`.trim()
        : '—';

      return {
        id: record.id,
        student: {
          id: record.students.id,
          name,
          photo_url: record.students.photo_url,
          student_id_no: record.students.student_id_no,
          department_code: record.students.classes?.departments.code ?? null,
          programme: record.students.classes?.courses.name ?? null,
          batch_label: record.students.classes?.batches.name ?? null,
          year_label: yearLabel(
            record.students.classes?.current_semester ?? null,
          ),
          section: record.students.classes?.section ?? null,
          mobile:
            record.students.soa_applications?.student_contact ??
            record.students.users.phone ??
            null,
          email: record.students.users.email,
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
            record.monthly_revenue != null
              ? Number(record.monthly_revenue)
              : null,
          team_size: record.team_size,
          funding_raised:
            record.funding_received != null
              ? Number(record.funding_received)
              : null,
        },
        entrepreneurship_status: {
          stage: record.stage,
          entrepreneur_type: record.role,
          year_started: record.year_started,
          current_status_note: record.current_status_note,
          registration_type: record.registration_type,
        },
        business_details: {
          business_name: record.business_name,
          sector: record.sector,
          business_category: record.business_category,
          problem_statement: record.problem_statement,
          location: record.location,
          solution_product: null,
          business_model: record.business_model,
          target_customers: record.target_customers,
          website: record.website,
          linkedin_url: record.linkedin_url,
        },
        founder_team: {
          founder_name: name,
          co_founders: record.co_founders,
          team_size: record.team_size,
          student_team_note: record.student_team_note,
          faculty_mentor: record.faculty
            ? `${record.faculty.first_name} ${record.faculty.last_name}`.trim()
            : null,
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
            record.monthly_revenue != null
              ? Number(record.monthly_revenue)
              : null,
          team_size: record.team_size,
          growth_stage: record.growth_stage,
        },
        funding: {
          funding_status: record.funding_status,
          funding_required:
            record.funding_required != null
              ? Number(record.funding_required)
              : null,
          funding_received:
            record.funding_received != null
              ? Number(record.funding_received)
              : null,
          funding_source: record.funding_source,
          govt_grant_scheme: record.govt_grant_scheme,
          incubator_support: record.incubator_support,
          accelerator_support: record.accelerator_support,
        },
        remarks: record.remarks,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD EDC profile', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
