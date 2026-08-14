import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { resolveFacultyName, INTERNAL_ERROR } from '../common/sports-common';
import { CreateDisciplineDto } from './dto/create-discipline.dto';
import { UpdateDisciplineDto } from './dto/update-discipline.dto';
import { SearchDisciplinesDto } from './dto/search-disciplines.dto';

const DISCIPLINE_INCLUDE = {
  faculty: { select: { id: true, first_name: true, last_name: true } },
  _count: {
    select: { sports_athlete_profiles: true, sports_teams: true },
  },
} satisfies Prisma.sports_disciplinesInclude;

type DisciplineWithRelations = Prisma.sports_disciplinesGetPayload<{
  include: typeof DISCIPLINE_INCLUDE;
}>;

function toDisciplineResponse(discipline: DisciplineWithRelations) {
  return {
    id: discipline.id,
    name: discipline.name,
    head_coach: discipline.faculty
      ? { id: discipline.faculty.id, name: resolveFacultyName(discipline.faculty) }
      : null,
    is_active: discipline.is_active,
    athlete_count: discipline._count.sports_athlete_profiles,
    team_count: discipline._count.sports_teams,
  };
}

@Injectable()
export class DisciplinesService {
  private readonly logger = new Logger(DisciplinesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/disciplines?q=&is_active= */
  async findAll(dto: SearchDisciplinesDto) {
    const where: Prisma.sports_disciplinesWhereInput = {};
    if (dto.q) {
      where.name = { contains: dto.q, mode: 'insensitive' };
    }
    if (dto.is_active !== undefined) {
      where.is_active = dto.is_active;
    }

    try {
      const disciplines = await this.prisma.sports_disciplines.findMany({
        where,
        include: DISCIPLINE_INCLUDE,
        orderBy: { name: 'asc' },
      });
      return disciplines.map(toDisciplineResponse);
    } catch (err) {
      this.logger.error('DB error while fetching disciplines', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/disciplines
   *
   * Error cases:
   *  409 DISCIPLINE_NAME_EXISTS – a discipline with this name already exists
   *  500 INTERNAL_ERROR – unexpected failure (DB, etc.)
   */
  async create(dto: CreateDisciplineDto) {
    const existing = await this.findByName(dto.name);
    if (existing) {
      throw new ConflictException({
        message: 'A discipline with this name already exists',
        errorCode: 'DISCIPLINE_NAME_EXISTS',
      });
    }

    try {
      const discipline = await this.prisma.sports_disciplines.create({
        data: {
          name: dto.name,
          head_coach_faculty_id: dto.head_coach_faculty_id,
          is_active: dto.is_active,
        },
        include: DISCIPLINE_INCLUDE,
      });
      return toDisciplineResponse(discipline);
    } catch (err) {
      this.logger.error('DB error while creating discipline', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/disciplines/:id
   *
   * Error cases:
   *  404 DISCIPLINE_NOT_FOUND – no discipline with the given id
   */
  async findOne(id: number) {
    const discipline = await this.findById(id);
    if (!discipline) {
      throw new NotFoundException({
        message: 'Discipline not found',
        errorCode: 'DISCIPLINE_NOT_FOUND',
      });
    }
    return toDisciplineResponse(discipline);
  }

  /**
   * PATCH /sports-admin/disciplines/:id
   *
   * Error cases:
   *  404 DISCIPLINE_NOT_FOUND – no discipline with the given id
   *  409 DISCIPLINE_NAME_EXISTS – another discipline already uses this name
   */
  async update(id: number, dto: UpdateDisciplineDto) {
    const discipline = await this.findById(id);
    if (!discipline) {
      throw new NotFoundException({
        message: 'Discipline not found',
        errorCode: 'DISCIPLINE_NOT_FOUND',
      });
    }

    if (dto.name) {
      const existing = await this.findByName(dto.name);
      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A discipline with this name already exists',
          errorCode: 'DISCIPLINE_NAME_EXISTS',
        });
      }
    }

    try {
      const updated = await this.prisma.sports_disciplines.update({
        where: { id },
        data: {
          name: dto.name,
          head_coach_faculty_id: dto.head_coach_faculty_id,
          is_active: dto.is_active,
        },
        include: DISCIPLINE_INCLUDE,
      });
      return toDisciplineResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating discipline', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/disciplines/:id
   *
   * Error cases:
   *  404 DISCIPLINE_NOT_FOUND – no discipline with the given id
   *  409 DISCIPLINE_IN_USE – discipline still has athletes or teams assigned to it
   */
  async remove(id: number) {
    const discipline = await this.findById(id);
    if (!discipline) {
      throw new NotFoundException({
        message: 'Discipline not found',
        errorCode: 'DISCIPLINE_NOT_FOUND',
      });
    }

    const inUseCount =
      discipline._count.sports_athlete_profiles + discipline._count.sports_teams;
    if (inUseCount > 0) {
      throw new ConflictException({
        message:
          'Cannot delete a discipline that still has athletes or teams assigned to it',
        errorCode: 'DISCIPLINE_IN_USE',
      });
    }

    try {
      await this.prisma.sports_disciplines.delete({ where: { id } });
      return { message: 'Discipline deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting discipline', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findByName(name: string) {
    try {
      return await this.prisma.sports_disciplines.findUnique({
        where: { name },
      });
    } catch (err) {
      this.logger.error('DB error during discipline name duplicate check', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.sports_disciplines.findUnique({
        where: { id },
        include: DISCIPLINE_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during discipline lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
