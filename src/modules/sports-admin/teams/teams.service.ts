import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import {
  FACULTY_DISPLAY_SELECT,
  INTERNAL_ERROR,
  STUDENT_DISPLAY_INCLUDE,
  resolveFacultyName,
  resolveStudentName,
  studentAcademicMeta,
} from '../common/sports-common';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { SearchTeamsDto } from './dto/search-teams.dto';
import { AddRosterEntryDto } from './dto/add-roster-entry.dto';
import { UpdateRosterEntryDto } from './dto/update-roster-entry.dto';

const CAPTAIN_SELECT = {
  id: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  users: { select: { email: true } },
} satisfies Prisma.studentsSelect;

const TEAM_LIST_INCLUDE = {
  sports_disciplines: { select: { id: true, name: true } },
  faculty: { select: { id: true, first_name: true, last_name: true } },
  students_sports_teams_captain_student_idTostudents: {
    select: CAPTAIN_SELECT,
  },
  _count: { select: { student_sports_team_mapping: true } },
} satisfies Prisma.sports_teamsInclude;

type TeamWithListRelations = Prisma.sports_teamsGetPayload<{
  include: typeof TEAM_LIST_INCLUDE;
}>;

const TEAM_DETAIL_INCLUDE = {
  sports_disciplines: { select: { id: true, name: true } },
  faculty: { select: FACULTY_DISPLAY_SELECT },
  sports_facilities: { select: { id: true, name: true } },
  students_sports_teams_captain_student_idTostudents: {
    select: CAPTAIN_SELECT,
  },
  students_sports_teams_vice_captain_student_idTostudents: {
    select: CAPTAIN_SELECT,
  },
} satisfies Prisma.sports_teamsInclude;

type TeamWithDetailRelations = Prisma.sports_teamsGetPayload<{
  include: typeof TEAM_DETAIL_INCLUDE;
}>;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Formats a @db.Date value as "MMM yyyy", e.g. "Jan 2026". */
function formatMonthYear(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toAchievementItem(achievement: {
  event_name: string;
  venue: string | null;
  achievement_date: Date;
  level: string | null;
  result: string;
}) {
  return {
    title: achievement.event_name,
    meta: `${achievement.venue ? `${achievement.venue} · ` : ''}${formatMonthYear(achievement.achievement_date)}`,
    level: achievement.level,
    award: achievement.result,
  };
}

function toTeamListResponse(team: TeamWithListRelations) {
  const captain = team.students_sports_teams_captain_student_idTostudents;
  return {
    id: team.id,
    name: team.name,
    discipline: team.sports_disciplines
      ? { id: team.sports_disciplines.id, name: team.sports_disciplines.name }
      : null,
    coach: team.faculty
      ? { id: team.faculty.id, name: resolveFacultyName(team.faculty) }
      : null,
    captain: captain
      ? { id: captain.id, name: resolveStudentName(captain) }
      : null,
    size: team._count.student_sports_team_mapping,
    status: team.status,
    category: team.category,
  };
}

function toTeamDetailResponse(
  team: TeamWithDetailRelations,
  roster: {
    student_id: number;
    name: string;
    jersey_no: string | null;
    squad_role: string | null;
    dept_year: string;
  }[],
  results: ReturnType<typeof toAchievementItem>[],
) {
  const captain = team.students_sports_teams_captain_student_idTostudents;
  const viceCaptain =
    team.students_sports_teams_vice_captain_student_idTostudents;

  return {
    id: team.id,
    code: `SQD-${String(team.id).padStart(3, '0')}`,
    name: team.name,
    discipline: team.sports_disciplines
      ? { id: team.sports_disciplines.id, name: team.sports_disciplines.name }
      : null,
    category: team.category,
    coach: team.faculty
      ? {
          id: team.faculty.id,
          name: resolveFacultyName(team.faculty),
          phone: team.faculty.users?.phone ?? null,
        }
      : null,
    captain: captain
      ? { id: captain.id, name: resolveStudentName(captain) }
      : null,
    vice_captain: viceCaptain
      ? { id: viceCaptain.id, name: resolveStudentName(viceCaptain) }
      : null,
    manager_name: team.manager_name,
    facility: team.sports_facilities
      ? { id: team.sports_facilities.id, name: team.sports_facilities.name }
      : null,
    practice_schedule: team.practice_schedule,
    formed_date: team.formed_date ? toDateOnly(team.formed_date) : null,
    played: team.played,
    won: team.won,
    lost: team.lost,
    drawn: team.drawn,
    status: team.status,
    roster,
    results,
  };
}

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/teams?discipline_id=&status=&q= */
  async findAll(dto: SearchTeamsDto) {
    const where: Prisma.sports_teamsWhereInput = {};
    if (dto.discipline_id) where.discipline_id = dto.discipline_id;
    if (dto.status) where.status = dto.status;
    if (dto.q) {
      where.OR = [
        { name: { contains: dto.q, mode: 'insensitive' } },
        { category: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    try {
      const teams = await this.prisma.sports_teams.findMany({
        where,
        include: TEAM_LIST_INCLUDE,
        orderBy: { name: 'asc' },
      });
      return teams.map(toTeamListResponse);
    } catch (err) {
      this.logger.error('DB error while fetching teams', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/teams
   *
   * Error cases:
   *  409 SPORTS_TEAM_NAME_EXISTS – a team with this name already exists
   */
  async create(dto: CreateTeamDto) {
    const existing = await this.findByName(dto.name);
    if (existing) {
      throw new ConflictException({
        message: 'A team with this name already exists',
        errorCode: 'SPORTS_TEAM_NAME_EXISTS',
      });
    }

    try {
      const team = await this.prisma.sports_teams.create({
        data: {
          name: dto.name,
          discipline_id: dto.discipline_id,
          coach_faculty_id: dto.coach_faculty_id,
          category: dto.category,
          captain_student_id: dto.captain_student_id,
          vice_captain_student_id: dto.vice_captain_student_id,
          manager_name: dto.manager_name,
          facility_id: dto.facility_id,
          practice_schedule: dto.practice_schedule,
          formed_date: dto.formed_date,
        },
        include: TEAM_LIST_INCLUDE,
      });

      // A captain/vice-captain is a squad member first — give them a real
      // roster row too, not just the leadership pointer, so they show up
      // in the squad list without a separate manual add.
      await Promise.all([
        this.ensureRosterRole(team.id, dto.captain_student_id, 'Captain'),
        this.ensureRosterRole(
          team.id,
          dto.vice_captain_student_id,
          'Vice captain',
        ),
      ]);

      return toTeamListResponse(team);
    } catch (err) {
      this.logger.error('DB error while creating team', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/teams/:id
   *
   * Error cases:
   *  404 SPORTS_TEAM_NOT_FOUND – no team with this id
   */
  async findOne(id: number) {
    const team = await this.findDetailById(id);
    if (!team) {
      throw new NotFoundException({
        message: 'Team not found',
        errorCode: 'SPORTS_TEAM_NOT_FOUND',
      });
    }

    const [roster, results] = await Promise.all([
      this.findRoster(id),
      this.findResults(id),
    ]);

    return toTeamDetailResponse(team, roster, results);
  }

  /**
   * PATCH /sports-admin/teams/:id
   *
   * Error cases:
   *  404 SPORTS_TEAM_NOT_FOUND – no team with this id
   *  409 SPORTS_TEAM_NAME_EXISTS – another team already uses the new name
   */
  async update(id: number, dto: UpdateTeamDto) {
    const team = await this.findListById(id);
    if (!team) {
      throw new NotFoundException({
        message: 'Team not found',
        errorCode: 'SPORTS_TEAM_NOT_FOUND',
      });
    }

    if (dto.name) {
      const existing = await this.findByName(dto.name);
      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A team with this name already exists',
          errorCode: 'SPORTS_TEAM_NAME_EXISTS',
        });
      }
    }

    try {
      const updated = await this.prisma.sports_teams.update({
        where: { id },
        data: {
          name: dto.name,
          discipline_id: dto.discipline_id,
          coach_faculty_id: dto.coach_faculty_id,
          category: dto.category,
          captain_student_id: dto.captain_student_id,
          vice_captain_student_id: dto.vice_captain_student_id,
          manager_name: dto.manager_name,
          facility_id: dto.facility_id,
          practice_schedule: dto.practice_schedule,
          formed_date: dto.formed_date,
        },
        include: TEAM_LIST_INCLUDE,
      });

      // Same reasoning as create(): keep the roster in sync whenever the
      // captain/vice-captain actually changes. Demote whoever held that
      // title before (only if their row still says exactly that role —
      // never clobber a role someone's since been given manually) before
      // giving the new one a roster row.
      if (
        dto.captain_student_id !== undefined &&
        dto.captain_student_id !== team.captain_student_id
      ) {
        await this.demoteRosterRole(id, team.captain_student_id, 'Captain');
        await this.ensureRosterRole(id, dto.captain_student_id, 'Captain');
      }
      if (
        dto.vice_captain_student_id !== undefined &&
        dto.vice_captain_student_id !== team.vice_captain_student_id
      ) {
        await this.demoteRosterRole(
          id,
          team.vice_captain_student_id,
          'Vice captain',
        );
        await this.ensureRosterRole(
          id,
          dto.vice_captain_student_id,
          'Vice captain',
        );
      }

      return toTeamListResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating team', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/teams/:id
   *
   * Error cases:
   *  404 SPORTS_TEAM_NOT_FOUND – no team with this id
   *  409 SPORTS_TEAM_HAS_ROSTER – roster entries still exist for this team
   */
  async remove(id: number) {
    const team = await this.findListById(id);
    if (!team) {
      throw new NotFoundException({
        message: 'Team not found',
        errorCode: 'SPORTS_TEAM_NOT_FOUND',
      });
    }

    let rosterCount: number;
    try {
      rosterCount = await this.prisma.student_sports_team_mapping.count({
        where: { team_id: id },
      });
    } catch (err) {
      this.logger.error('DB error during roster count check', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (rosterCount > 0) {
      throw new ConflictException({
        message:
          'Cannot delete a team that still has roster entries assigned to it',
        errorCode: 'SPORTS_TEAM_HAS_ROSTER',
      });
    }

    try {
      await this.prisma.sports_teams.delete({ where: { id } });
      return { message: 'Team deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting team', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/teams/:id/roster — upsert semantics (see AddRosterEntryDto).
   *
   * Error cases:
   *  404 SPORTS_TEAM_NOT_FOUND – no team with this id
   *  404 STUDENT_NOT_FOUND – student_id does not exist
   */
  async addRosterEntry(teamId: number, dto: AddRosterEntryDto) {
    const team = await this.findListById(teamId);
    if (!team) {
      throw new NotFoundException({
        message: 'Team not found',
        errorCode: 'SPORTS_TEAM_NOT_FOUND',
      });
    }

    let student: unknown;
    try {
      student = await this.prisma.students.findUnique({
        where: { id: dto.student_id },
      });
    } catch (err) {
      this.logger.error('DB error during student lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    try {
      await this.prisma.student_sports_team_mapping.upsert({
        where: {
          student_id_team_id: { student_id: dto.student_id, team_id: teamId },
        },
        update: { jersey_no: dto.jersey_no, squad_role: dto.squad_role },
        create: {
          student_id: dto.student_id,
          team_id: teamId,
          jersey_no: dto.jersey_no,
          squad_role: dto.squad_role,
        },
      });
    } catch (err) {
      this.logger.error('DB error while adding roster entry', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    return { roster: await this.findRoster(teamId) };
  }

  /**
   * PATCH /sports-admin/teams/:id/roster/:studentId
   *
   * Error cases:
   *  404 ROSTER_ENTRY_NOT_FOUND – no mapping for this [team, student] pair
   */
  async updateRosterEntry(
    teamId: number,
    studentId: number,
    dto: UpdateRosterEntryDto,
  ) {
    const entry = await this.findRosterEntry(teamId, studentId);
    if (!entry) {
      throw new NotFoundException({
        message: 'Roster entry not found',
        errorCode: 'ROSTER_ENTRY_NOT_FOUND',
      });
    }

    try {
      await this.prisma.student_sports_team_mapping.update({
        where: {
          student_id_team_id: { student_id: studentId, team_id: teamId },
        },
        data: { jersey_no: dto.jersey_no, squad_role: dto.squad_role },
      });
    } catch (err) {
      this.logger.error('DB error while updating roster entry', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    return { roster: await this.findRoster(teamId) };
  }

  /**
   * DELETE /sports-admin/teams/:id/roster/:studentId
   *
   * Error cases:
   *  404 ROSTER_ENTRY_NOT_FOUND – no mapping for this [team, student] pair
   */
  async removeRosterEntry(teamId: number, studentId: number) {
    const entry = await this.findRosterEntry(teamId, studentId);
    if (!entry) {
      throw new NotFoundException({
        message: 'Roster entry not found',
        errorCode: 'ROSTER_ENTRY_NOT_FOUND',
      });
    }

    try {
      await this.prisma.student_sports_team_mapping.delete({
        where: {
          student_id_team_id: { student_id: studentId, team_id: teamId },
        },
      });
      return { message: 'Roster entry removed successfully' };
    } catch (err) {
      this.logger.error('DB error while removing roster entry', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/teams/:id/confirm — sets status='confirmed'.
   *
   * Error cases:
   *  404 SPORTS_TEAM_NOT_FOUND – no team with this id
   */
  async confirm(id: number) {
    const team = await this.findListById(id);
    if (!team) {
      throw new NotFoundException({
        message: 'Team not found',
        errorCode: 'SPORTS_TEAM_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.sports_teams.update({
        where: { id },
        data: { status: 'confirmed' },
        include: TEAM_LIST_INCLUDE,
      });
      return toTeamListResponse(updated);
    } catch (err) {
      this.logger.error('DB error while confirming team', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** Gives a student a roster row with this squad_role, creating the row if they weren't already on the squad. */
  private async ensureRosterRole(
    teamId: number,
    studentId: number | undefined | null,
    role: string,
  ): Promise<void> {
    if (!studentId) return;
    try {
      await this.prisma.student_sports_team_mapping.upsert({
        where: {
          student_id_team_id: { student_id: studentId, team_id: teamId },
        },
        update: { squad_role: role },
        create: { student_id: studentId, team_id: teamId, squad_role: role },
      });
    } catch (err) {
      this.logger.error('DB error while syncing roster leadership role', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** Reverts a former captain/vice-captain's roster row back to a plain player — only if it still says exactly `fromRole`, so a role someone's since been given manually is never overwritten. */
  private async demoteRosterRole(
    teamId: number,
    studentId: number | undefined | null,
    fromRole: string,
  ): Promise<void> {
    if (!studentId) return;
    try {
      await this.prisma.student_sports_team_mapping.updateMany({
        where: { team_id: teamId, student_id: studentId, squad_role: fromRole },
        data: { squad_role: 'Player' },
      });
    } catch (err) {
      this.logger.error(
        'DB error while demoting former roster leadership role',
        err,
      );
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findListById(
    id: number,
  ): Promise<TeamWithListRelations | null> {
    try {
      return await this.prisma.sports_teams.findUnique({
        where: { id },
        include: TEAM_LIST_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during team lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findDetailById(
    id: number,
  ): Promise<TeamWithDetailRelations | null> {
    try {
      return await this.prisma.sports_teams.findUnique({
        where: { id },
        include: TEAM_DETAIL_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during team lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findByName(name: string) {
    try {
      return await this.prisma.sports_teams.findUnique({ where: { name } });
    } catch (err) {
      this.logger.error('DB error during team name duplicate check', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findRosterEntry(teamId: number, studentId: number) {
    try {
      return await this.prisma.student_sports_team_mapping.findUnique({
        where: {
          student_id_team_id: { student_id: studentId, team_id: teamId },
        },
      });
    } catch (err) {
      this.logger.error('DB error during roster entry lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findRoster(teamId: number) {
    try {
      const rows = await this.prisma.student_sports_team_mapping.findMany({
        where: { team_id: teamId },
        include: { students: { include: STUDENT_DISPLAY_INCLUDE } },
      });
      return rows.map((row) => ({
        student_id: row.student_id,
        name: resolveStudentName(row.students),
        jersey_no: row.jersey_no,
        squad_role: row.squad_role,
        dept_year: studentAcademicMeta(row.students),
      }));
    } catch (err) {
      this.logger.error('DB error while fetching team roster', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findResults(teamId: number) {
    try {
      const rows = await this.prisma.sports_achievements.findMany({
        where: { team_id: teamId },
        orderBy: { achievement_date: 'desc' },
      });
      return rows.map(toAchievementItem);
    } catch (err) {
      this.logger.error('DB error while fetching team results', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
