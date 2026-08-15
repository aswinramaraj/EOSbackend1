import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { INTERNAL_ERROR } from 'src/modules/sports-admin/common/sports-common';
import { CreateFixtureDto } from './dto/create-fixture.dto';
import { UpdateFixtureDto } from './dto/update-fixture.dto';
import { SearchFixturesDto } from './dto/search-fixtures.dto';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toTimeOnly(date: Date): string {
  return date.toISOString().slice(11, 16);
}

/** HH:mm or HH:mm:ss -> a Date usable for the @db.Time fixture_time column. */
function timeStringToDate(time: string): Date {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return new Date(`1970-01-01T${normalized}.000Z`);
}

const FIXTURE_INCLUDE = {
  sports_disciplines: { select: { id: true, name: true } },
  sports_teams: { select: { id: true, name: true } },
  sports_facilities: { select: { id: true, name: true } },
} satisfies Prisma.sports_fixturesInclude;

type FixtureWithRelations = Prisma.sports_fixturesGetPayload<{
  include: typeof FIXTURE_INCLUDE;
}>;

function toFixtureResponse(fixture: FixtureWithRelations) {
  return {
    id: fixture.id,
    title: fixture.title,
    discipline: fixture.sports_disciplines
      ? { id: fixture.sports_disciplines.id, name: fixture.sports_disciplines.name }
      : null,
    team: fixture.sports_teams
      ? { id: fixture.sports_teams.id, name: fixture.sports_teams.name }
      : null,
    opponent: fixture.opponent,
    facility: fixture.sports_facilities
      ? { id: fixture.sports_facilities.id, name: fixture.sports_facilities.name }
      : null,
    is_home: fixture.is_home,
    fixture_date: toDateOnly(fixture.fixture_date),
    fixture_time: fixture.fixture_time ? toTimeOnly(fixture.fixture_time) : null,
    status: fixture.status,
    result: fixture.result,
  };
}

@Injectable()
export class FixturesService {
  private readonly logger = new Logger(FixturesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/fixtures?status=&discipline_id=&from=&to= */
  async findAll(dto: SearchFixturesDto) {
    const where: Prisma.sports_fixturesWhereInput = {};
    if (dto.status) where.status = dto.status;
    if (dto.discipline_id) where.discipline_id = dto.discipline_id;
    if (dto.from || dto.to) {
      where.fixture_date = {
        ...(dto.from ? { gte: new Date(dto.from) } : {}),
        ...(dto.to ? { lte: new Date(dto.to) } : {}),
      };
    }

    try {
      const fixtures = await this.prisma.sports_fixtures.findMany({
        where,
        include: FIXTURE_INCLUDE,
        orderBy: { fixture_date: 'asc' },
      });
      return fixtures.map(toFixtureResponse);
    } catch (err) {
      this.logger.error('DB error while fetching fixtures', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** POST /sports-admin/fixtures */
  async create(dto: CreateFixtureDto) {
    try {
      const fixture = await this.prisma.sports_fixtures.create({
        data: {
          title: dto.title,
          discipline_id: dto.discipline_id,
          team_id: dto.team_id,
          opponent: dto.opponent,
          facility_id: dto.facility_id,
          is_home: dto.is_home,
          fixture_date: new Date(dto.fixture_date),
          fixture_time: dto.fixture_time
            ? timeStringToDate(dto.fixture_time)
            : undefined,
          result: dto.result,
        },
        include: FIXTURE_INCLUDE,
      });
      return toFixtureResponse(fixture);
    } catch (err) {
      this.logger.error('DB error while creating fixture', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/fixtures/:id
   *
   * Error cases:
   *  404 FIXTURE_NOT_FOUND – no fixture with the given id
   */
  async findOne(id: number) {
    const fixture = await this.findById(id);
    if (!fixture) {
      throw new NotFoundException({
        message: 'Fixture not found',
        errorCode: 'FIXTURE_NOT_FOUND',
      });
    }
    return toFixtureResponse(fixture);
  }

  /**
   * PATCH /sports-admin/fixtures/:id
   *
   * Error cases:
   *  404 FIXTURE_NOT_FOUND – no fixture with the given id
   */
  async update(id: number, dto: UpdateFixtureDto) {
    const fixture = await this.findById(id);
    if (!fixture) {
      throw new NotFoundException({
        message: 'Fixture not found',
        errorCode: 'FIXTURE_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.sports_fixtures.update({
        where: { id },
        data: {
          title: dto.title,
          discipline_id: dto.discipline_id,
          team_id: dto.team_id,
          opponent: dto.opponent,
          facility_id: dto.facility_id,
          is_home: dto.is_home,
          fixture_date: dto.fixture_date ? new Date(dto.fixture_date) : undefined,
          fixture_time: dto.fixture_time
            ? timeStringToDate(dto.fixture_time)
            : undefined,
          result: dto.result,
        },
        include: FIXTURE_INCLUDE,
      });
      return toFixtureResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating fixture', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/fixtures/:id
   *
   * Error cases:
   *  404 FIXTURE_NOT_FOUND – no fixture with the given id
   */
  async remove(id: number) {
    const fixture = await this.findById(id);
    if (!fixture) {
      throw new NotFoundException({
        message: 'Fixture not found',
        errorCode: 'FIXTURE_NOT_FOUND',
      });
    }

    try {
      await this.prisma.sports_fixtures.delete({ where: { id } });
      return { message: 'Fixture deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting fixture', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/fixtures/:id/confirm
   *
   * Error cases:
   *  404 FIXTURE_NOT_FOUND – no fixture with the given id
   */
  async confirm(id: number) {
    const fixture = await this.findById(id);
    if (!fixture) {
      throw new NotFoundException({
        message: 'Fixture not found',
        errorCode: 'FIXTURE_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.sports_fixtures.update({
        where: { id },
        data: { status: 'confirmed' },
        include: FIXTURE_INCLUDE,
      });
      return toFixtureResponse(updated);
    } catch (err) {
      this.logger.error('DB error while confirming fixture', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.sports_fixtures.findUnique({
        where: { id },
        include: FIXTURE_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during fixture lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
