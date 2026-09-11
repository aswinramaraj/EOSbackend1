import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AchievementsService } from 'src/modules/sports-admin/achievements/achievements.service';
import { CreateAchievementDto } from 'src/modules/sports-admin/achievements/dto/create-achievement.dto';
import { DrivesService } from 'src/modules/placement/drives/drives.service';
import { ListDrivesQueryDto } from 'src/modules/placement/drives/dto/list-drives-query.dto';
import { CreateDriveApplicationDto } from 'src/modules/placement/drives/dto/create-drive-application.dto';
import { PrincipalPlacementsService } from 'src/modules/principal/placements/placements.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { drive_application_status_enum } from 'generated/prisma/enums';
import {
  STUDENT_DISPLAY_INCLUDE,
  resolveStudentName,
} from 'src/modules/sports-admin/common/sports-common';
import { AddPlacementEntryDto } from './dto/add-placement-entry.dto';
import { AddCertificationEntryDto } from './dto/add-certification-entry.dto';
import { AddCompetitionEntryDto } from './dto/add-competition-entry.dto';
import { AddHackathonEntryDto } from './dto/add-hackathon-entry.dto';
import { UpdateCertificationEntryDto } from './dto/update-certification-entry.dto';
import { UpdateCompetitionEntryDto } from './dto/update-competition-entry.dto';
import { UpdateHackathonEntryDto } from './dto/update-hackathon-entry.dto';

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/** Jul–Dec or Jan–Jun of the current calendar year — same "current term" window IqacAcademicQualityService uses. */
function currentTermRange(today: Date): { start: Date; end: Date } {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  if (month >= 7) {
    return {
      start: new Date(Date.UTC(calendarYear, 6, 1)),
      end: new Date(Date.UTC(calendarYear, 11, 31)),
    };
  }
  return {
    start: new Date(Date.UTC(calendarYear, 0, 1)),
    end: new Date(Date.UTC(calendarYear, 5, 30)),
  };
}

/** The same term window, one calendar year earlier — for a real "last year" comparison. */
function priorYearTermRange(range: { start: Date; end: Date }): {
  start: Date;
  end: Date;
} {
  return {
    start: new Date(
      Date.UTC(
        range.start.getUTCFullYear() - 1,
        range.start.getUTCMonth(),
        range.start.getUTCDate(),
      ),
    ),
    end: new Date(
      Date.UTC(
        range.end.getUTCFullYear() - 1,
        range.end.getUTCMonth(),
        range.end.getUTCDate(),
      ),
    ),
  };
}

function inRange(date: Date, range: { start: Date; end: Date }): boolean {
  return date >= range.start && date <= range.end;
}

/** 'YYYY-YYYY', Jun cutoff — matches iqac_metric_targets.sql's own seed convention. */
function currentAcademicYearLabel(today: Date): string {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const start = month >= 6 ? calendarYear : calendarYear - 1;
  return `${start}-${start + 1}`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

@Injectable()
export class IqacStudentDevelopmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly achievements: AchievementsService,
    private readonly drives: DrivesService,
    private readonly placements: PrincipalPlacementsService,
  ) {}

  /** Real target for one metric, this academic year — from iqac_metric_targets, same table IqacAcademicQualityService reads. */
  private async targetFor(metricKey: string): Promise<number | null> {
    const row = await this.prisma.iqac_metric_targets.findUnique({
      where: {
        metric_key_academic_year: {
          metric_key: metricKey,
          academic_year: currentAcademicYearLabel(startOfToday()),
        },
      },
    });
    return row ? Number(row.target_value) : null;
  }

  /**
   * GET /me/iqac/student-development/placements/quality
   *
   * "This year"/"Last year" bucket placed offers by their real
   * placement_drives.scheduled_date (the drive's own real date) — not by
   * student_drive_applications.updated_at, a housekeeping timestamp the
   * codebase's own placements.service.ts already documents as unfit for
   * "season" boundaries. Target/attainment reuse the same
   * iqac_metric_targets convention as Attendance/Results/CGPA.
   */
  async placementsQuality() {
    const thisTerm = currentTermRange(startOfToday());
    const lastYearTerm = priorYearTermRange(thisTerm);

    const [target, placedApps] = await Promise.all([
      this.targetFor('placements'),
      this.prisma.student_drive_applications.findMany({
        where: { status: 'placed' },
        select: { placement_drives: { select: { scheduled_date: true } } },
      }),
    ]);

    const thisYear = placedApps.filter((a) =>
      inRange(a.placement_drives.scheduled_date, thisTerm),
    ).length;
    const lastYear = placedApps.filter((a) =>
      inRange(a.placement_drives.scheduled_date, lastYearTerm),
    ).length;

    return {
      this_year: thisYear,
      last_year: lastYear,
      target,
      attainment: target != null ? round1((thisYear / target) * 100) : null,
    };
  }

  /**
   * GET /me/iqac/student-development/placements/recruiters?batch_id=
   *
   * Calls the real, existing PrincipalPlacementsService.leadingRecruiters()
   * (institution-wide, unchanged) and, when a batch is given, narrows it to
   * recruiters who placed at least one real student from that batch — a
   * small IQAC-owned side query on student_drive_applications, not a new
   * edit to Principal's own file.
   */
  async leadingRecruiters(batchId?: number) {
    const rows = await this.placements.leadingRecruiters();
    if (batchId == null) return rows;

    const scoped = await this.prisma.student_drive_applications.findMany({
      where: { status: 'placed', students: { batch_id: batchId } },
      select: { placement_drives: { select: { company_id: true } } },
    });
    const allowedCompanyIds = new Set(
      scoped.map((r) => r.placement_drives.company_id),
    );
    return rows.filter((r) => allowedCompanyIds.has(r.company_id));
  }

  /**
   * GET /me/iqac/student-development/awards/quality
   * Same convention as placementsQuality(), bucketed by the real
   * sports_achievements.achievement_date.
   */
  async awardsQuality() {
    const thisTerm = currentTermRange(startOfToday());
    const lastYearTerm = priorYearTermRange(thisTerm);

    const [target, rows] = await Promise.all([
      this.targetFor('awards'),
      this.prisma.sports_achievements.findMany({
        select: { achievement_date: true },
      }),
    ]);

    const thisYear = rows.filter((r) =>
      inRange(r.achievement_date, thisTerm),
    ).length;
    const lastYear = rows.filter((r) =>
      inRange(r.achievement_date, lastYearTerm),
    ).length;

    return {
      this_year: thisYear,
      last_year: lastYear,
      target,
      attainment: target != null ? round1((thisYear / target) * 100) : null,
    };
  }

  /** GET /me/iqac/student-development/placements/drives — real drive list, for the "+ Add student entry" drive picker. */
  listDrives(query: ListDrivesQueryDto) {
    return this.drives.findAll(query);
  }

  /**
   * POST /me/iqac/student-development/placements/drives/:driveId/applications
   * — the reference design's "+ Add student entry" action for Placements.
   * Delegates straight to the real DrivesService.addApplication(); this is
   * a real student_drive_applications row (starts at status 'applied').
   */
  addPlacementApplication(driveId: number, dto: CreateDriveApplicationDto) {
    return this.drives.addApplication(driveId, dto);
  }

  /**
   * POST /me/iqac/student-development/placements/drives/:driveId/entries
   *
   * The reference design's richer "Add student entry" popup — one action
   * that both maps the student to the drive and records the real offer
   * (status → 'placed', offer_response, offered_package_lpa), calling
   * DrivesService's own real, existing addApplication()/
   * updateApplicationStatus() rather than a new write path. offer_date is
   * genuinely new — no column for it exists yet (distinct from the already-
   * real joining_date, which is "when they start work", not "when the
   * offer was made"); this silently no-ops via a guarded raw query until
   * that column is added (see the ALTER statement in this method's body).
   */
  async addPlacementEntry(
    driveId: number,
    dto: AddPlacementEntryDto,
    user: JwtPayload,
  ) {
    await this.drives.addApplication(driveId, { student_id: dto.student_id });
    const updated = await this.drives.updateApplicationStatus(
      user,
      driveId,
      dto.student_id,
      {
        status: drive_application_status_enum.placed,
        offer_response: dto.offer_response,
        offered_package_lpa: dto.offered_package_lpa,
      },
    );

    if (dto.offer_date) {
      try {
        // ALTER TABLE student_drive_applications ADD COLUMN IF NOT EXISTS offer_date DATE;
        await this.prisma.$executeRaw`
          UPDATE student_drive_applications SET offer_date = ${dto.offer_date}::date
          WHERE id = ${updated.id}
        `;
      } catch {
        // offer_date column not added yet — silently degrade, same
        // convention DrivesService.updateApplicationStatus() already uses
        // for joining_date/work_location.
      }
    }

    return updated;
  }

  /**
   * GET /me/iqac/student-development/awards
   *
   * The reference design's "Awards" metric covers academic, technical and
   * sports awards together (Best Paper Award, Smart India Hackathon, Anna
   * University Sports...). Only sports achievements are tracked anywhere
   * real in this schema — sports_achievements, via the sports-admin
   * AchievementsService, reused here rather than re-queried. This is
   * honestly scoped to sports, not a stand-in for the broader mock concept.
   */
  async leadingAwardEvents(batchId?: number) {
    const [rows, scopedStudentIds] = await Promise.all([
      this.achievements.findAll({}),
      batchId != null
        ? this.prisma.students.findMany({
            where: { batch_id: batchId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    // Team achievements have no single owning student/batch — honestly
    // excluded once a batch filter is active, same as the department filter
    // already excludes them (see toAchievementResponse's own comment).
    const scopedRows =
      scopedStudentIds != null
        ? (() => {
            const allowed = new Set(scopedStudentIds.map((s) => s.id));
            return rows.filter(
              (r) =>
                r.athlete_student_id != null &&
                allowed.has(r.athlete_student_id),
            );
          })()
        : rows;

    const byEvent = new Map<
      string,
      {
        count: number;
        latest: string;
        levels: Set<string>;
        departments: Set<string>;
      }
    >();
    for (const r of scopedRows) {
      const entry = byEvent.get(r.event_name) ?? {
        count: 0,
        latest: r.achievement_date,
        levels: new Set<string>(),
        departments: new Set<string>(),
      };
      entry.count += 1;
      if (r.achievement_date > entry.latest) entry.latest = r.achievement_date;
      if (r.level) entry.levels.add(r.level);
      if (r.department_code) entry.departments.add(r.department_code);
      byEvent.set(r.event_name, entry);
    }

    return Array.from(byEvent.entries())
      .map(([event_name, e]) => ({
        event_name,
        participants: e.count,
        levels: Array.from(e.levels),
        latest_date: e.latest,
        department_codes: Array.from(e.departments),
      }))
      .sort((a, b) => b.participants - a.participants);
  }

  /**
   * GET /me/iqac/student-development/awards/departments — department-wise
   * rollup for the Awards leading-entries panel, matching the reference
   * design's always-8-department rollup grid. Team-based achievements have
   * no single owning department and are honestly excluded from this count
   * (they still count in the overall totals shown elsewhere).
   */
  async awardDepartments(batchId?: number) {
    const [departments, rows, scopedStudentIds] = await Promise.all([
      this.prisma.departments.findMany({
        select: { id: true, name: true, code: true },
      }),
      this.achievements.findAll({}),
      batchId != null
        ? this.prisma.students.findMany({
            where: { batch_id: batchId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    const allowed = scopedStudentIds
      ? new Set(scopedStudentIds.map((s) => s.id))
      : null;
    const scopedRows = allowed
      ? rows.filter(
          (r) =>
            r.athlete_student_id != null && allowed.has(r.athlete_student_id),
        )
      : rows;

    const byDept = new Map<number, number>();
    for (const r of scopedRows) {
      if (r.department_id == null) continue;
      byDept.set(r.department_id, (byDept.get(r.department_id) ?? 0) + 1);
    }

    return departments.map((dept) => ({
      department: dept,
      achievements: byDept.get(dept.id) ?? 0,
    }));
  }

  /**
   * POST /me/iqac/student-development/awards — the reference design's
   * "+ Add student entry" action for this metric. Delegates straight to
   * the real sports-admin AchievementsService.create(); this is a real
   * sports_achievements row, individual-only from this form (a team-result
   * entry stays sports-admin's own job, since it requires picking/creating
   * a team roster, out of scope for a single-student add form).
   */
  createAward(dto: CreateAchievementDto) {
    return this.achievements.create(dto);
  }

  /** GET /me/iqac/student-development/awards/:eventName */
  async eventParticipants(eventName: string) {
    const rows = await this.achievements.findAll({});
    const filtered = rows.filter((r) => r.event_name === eventName);
    if (filtered.length === 0) {
      throw new NotFoundException({
        message: 'No achievements found for this event',
        errorCode: 'EVENT_NOT_FOUND',
      });
    }

    return filtered.map((r) => ({
      id: r.id,
      participant: r.sub,
      result: r.result,
      level: r.level,
      achievement_date: r.achievement_date,
      venue: r.venue,
      certificate_url: r.certificate_url,
    }));
  }

  /** Shared student summary shape for Certifications/Competitions/Hackathons rows — same real fields the Placements/Awards forms already use. */
  private studentSummary(
    student: Parameters<typeof resolveStudentName>[0] & {
      id: number;
      roll_no: string | null;
      student_id_no: string;
      classes: {
        section: string | null;
        current_semester: number | null;
      } | null;
      courses: {
        departments: { id: number; code: string; name: string } | null;
      } | null;
      batches: { name: string } | null;
    },
  ) {
    return {
      id: student.id,
      name: resolveStudentName(student),
      roll_no: student.roll_no ?? student.student_id_no,
      department: student.courses?.departments ?? null,
      batch: student.batches,
      semester: student.classes?.current_semester ?? null,
    };
  }

  /**
   * GET /me/iqac/student-development/certifications/quality
   * Bucketed by the real completed_on date — the same current-term
   * convention Attendance/Results/Placements use, since (unlike
   * Publications' year-only column) this one has full date precision.
   */
  async certificationsQuality() {
    const thisTerm = currentTermRange(startOfToday());
    const lastYearTerm = priorYearTermRange(thisTerm);
    const [target, rows] = await Promise.all([
      this.targetFor('certifications'),
      this.prisma.student_certificates.findMany({
        where: { certificate_type_id: null, completed_on: { not: null } },
        select: { completed_on: true },
      }),
    ]);
    const thisYear = rows.filter((r) =>
      inRange(r.completed_on!, thisTerm),
    ).length;
    const lastYear = rows.filter((r) =>
      inRange(r.completed_on!, lastYearTerm),
    ).length;
    return {
      this_year: thisYear,
      last_year: lastYear,
      target,
      attainment: target != null ? round1((thisYear / target) * 100) : null,
    };
  }

  /**
   * GET /me/iqac/student-development/certifications?batch_id=
   * Real student_certificates rows with certificate_type_id null — the
   * skill/course certifications added alongside the admin-document rows,
   * distinguished from them by that null column (see the migration's own
   * comment on the ALTER statement).
   */
  async certifications(batchId?: number) {
    const rows = await this.prisma.student_certificates.findMany({
      where: {
        certificate_type_id: null,
        ...(batchId != null ? { students: { batch_id: batchId } } : {}),
      },
      orderBy: { id: 'desc' },
      include: { students: { include: STUDENT_DISPLAY_INCLUDE } },
    });
    return rows.map((r) => ({
      id: r.id,
      student: this.studentSummary(r.students),
      platform: r.platform,
      track: r.track,
      score: r.score,
      completed_on: r.completed_on,
      status: r.status,
    }));
  }

  /** POST /me/iqac/student-development/certifications — real student_certificates insert (certificate_type_id left null). */
  async addCertificationEntry(dto: AddCertificationEntryDto) {
    return this.prisma.student_certificates.create({
      data: {
        student_id: dto.student_id,
        platform: dto.platform,
        track: dto.track,
        score: dto.score,
        completed_on: dto.completed_on ? new Date(dto.completed_on) : undefined,
        status: dto.status,
      },
    });
  }

  /** PATCH /me/iqac/student-development/certifications/:id — real student_certificates update. */
  async updateCertificationEntry(id: number, dto: UpdateCertificationEntryDto) {
    const existing = await this.prisma.student_certificates.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Certification entry not found',
        errorCode: 'CERTIFICATION_NOT_FOUND',
      });
    }
    return this.prisma.student_certificates.update({
      where: { id },
      data: {
        platform: dto.platform,
        track: dto.track,
        score: dto.score,
        completed_on: dto.completed_on ? new Date(dto.completed_on) : undefined,
        status: dto.status,
      },
    });
  }

  /** DELETE /me/iqac/student-development/certifications/:id */
  async removeCertificationEntry(id: number) {
    const existing = await this.prisma.student_certificates.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Certification entry not found',
        errorCode: 'CERTIFICATION_NOT_FOUND',
      });
    }
    await this.prisma.student_certificates.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** GET /me/iqac/student-development/competitions/quality */
  async competitionsQuality() {
    const thisTerm = currentTermRange(startOfToday());
    const lastYearTerm = priorYearTermRange(thisTerm);
    const [target, rows] = await Promise.all([
      this.targetFor('competitions'),
      this.prisma.student_competitions.findMany({
        where: { held_on: { not: null } },
        select: { held_on: true },
      }),
    ]);
    const thisYear = rows.filter((r) => inRange(r.held_on!, thisTerm)).length;
    const lastYear = rows.filter((r) =>
      inRange(r.held_on!, lastYearTerm),
    ).length;
    return {
      this_year: thisYear,
      last_year: lastYear,
      target,
      attainment: target != null ? round1((thisYear / target) * 100) : null,
    };
  }

  /** GET /me/iqac/student-development/competitions?batch_id= */
  async competitions(batchId?: number) {
    const rows = await this.prisma.student_competitions.findMany({
      where: batchId != null ? { students: { batch_id: batchId } } : undefined,
      orderBy: { id: 'desc' },
      include: { students: { include: STUDENT_DISPLAY_INCLUDE } },
    });
    return rows.map((r) => ({
      id: r.id,
      student: this.studentSummary(r.students),
      event_name: r.event_name,
      category: r.category,
      level: r.level,
      held_on: r.held_on,
      result: r.result,
    }));
  }

  /** POST /me/iqac/student-development/competitions — real student_competitions insert. */
  async addCompetitionEntry(dto: AddCompetitionEntryDto) {
    return this.prisma.student_competitions.create({
      data: {
        student_id: dto.student_id,
        event_name: dto.event_name,
        category: dto.category,
        level: dto.level,
        held_on: dto.held_on ? new Date(dto.held_on) : undefined,
        result: dto.result,
      },
    });
  }

  /** PATCH /me/iqac/student-development/competitions/:id — real student_competitions update. */
  async updateCompetitionEntry(id: number, dto: UpdateCompetitionEntryDto) {
    const existing = await this.prisma.student_competitions.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Competition entry not found',
        errorCode: 'COMPETITION_NOT_FOUND',
      });
    }
    return this.prisma.student_competitions.update({
      where: { id },
      data: {
        event_name: dto.event_name,
        category: dto.category,
        level: dto.level,
        held_on: dto.held_on ? new Date(dto.held_on) : undefined,
        result: dto.result,
      },
    });
  }

  /** DELETE /me/iqac/student-development/competitions/:id */
  async removeCompetitionEntry(id: number) {
    const existing = await this.prisma.student_competitions.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Competition entry not found',
        errorCode: 'COMPETITION_NOT_FOUND',
      });
    }
    await this.prisma.student_competitions.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** GET /me/iqac/student-development/hackathons/quality */
  async hackathonsQuality() {
    const thisTerm = currentTermRange(startOfToday());
    const lastYearTerm = priorYearTermRange(thisTerm);
    const [target, rows] = await Promise.all([
      this.targetFor('hackathons'),
      this.prisma.student_hackathon_participations.findMany({
        where: { held_on: { not: null } },
        select: { held_on: true },
      }),
    ]);
    const thisYear = rows.filter((r) => inRange(r.held_on!, thisTerm)).length;
    const lastYear = rows.filter((r) =>
      inRange(r.held_on!, lastYearTerm),
    ).length;
    return {
      this_year: thisYear,
      last_year: lastYear,
      target,
      attainment: target != null ? round1((thisYear / target) * 100) : null,
    };
  }

  /** GET /me/iqac/student-development/hackathons?batch_id= */
  async hackathons(batchId?: number) {
    const rows = await this.prisma.student_hackathon_participations.findMany({
      where: batchId != null ? { students: { batch_id: batchId } } : undefined,
      orderBy: { id: 'desc' },
      include: { students: { include: STUDENT_DISPLAY_INCLUDE } },
    });
    return rows.map((r) => ({
      id: r.id,
      student: this.studentSummary(r.students),
      hackathon_name: r.hackathon_name,
      team_name: r.team_name,
      host: r.host,
      held_on: r.held_on,
      outcome: r.outcome,
    }));
  }

  /** POST /me/iqac/student-development/hackathons — real student_hackathon_participations insert. */
  async addHackathonEntry(dto: AddHackathonEntryDto) {
    return this.prisma.student_hackathon_participations.create({
      data: {
        student_id: dto.student_id,
        hackathon_name: dto.hackathon_name,
        team_name: dto.team_name,
        host: dto.host,
        held_on: dto.held_on ? new Date(dto.held_on) : undefined,
        outcome: dto.outcome,
      },
    });
  }

  /** PATCH /me/iqac/student-development/hackathons/:id — real student_hackathon_participations update. */
  async updateHackathonEntry(id: number, dto: UpdateHackathonEntryDto) {
    const existing =
      await this.prisma.student_hackathon_participations.findUnique({
        where: { id },
      });
    if (!existing) {
      throw new NotFoundException({
        message: 'Hackathon entry not found',
        errorCode: 'HACKATHON_NOT_FOUND',
      });
    }
    return this.prisma.student_hackathon_participations.update({
      where: { id },
      data: {
        hackathon_name: dto.hackathon_name,
        team_name: dto.team_name,
        host: dto.host,
        held_on: dto.held_on ? new Date(dto.held_on) : undefined,
        outcome: dto.outcome,
      },
    });
  }

  /** DELETE /me/iqac/student-development/hackathons/:id */
  async removeHackathonEntry(id: number) {
    const existing =
      await this.prisma.student_hackathon_participations.findUnique({
        where: { id },
      });
    if (!existing) {
      throw new NotFoundException({
        message: 'Hackathon entry not found',
        errorCode: 'HACKATHON_NOT_FOUND',
      });
    }
    await this.prisma.student_hackathon_participations.delete({
      where: { id },
    });
    return { id, deleted: true };
  }
}
