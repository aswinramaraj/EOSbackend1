import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma, sports_facilities } from 'generated/prisma/client';
import { INTERNAL_ERROR } from '../common/sports-common';
import { CreateFacilityDto } from './dto/create-facility.dto';
import { UpdateFacilityDto } from './dto/update-facility.dto';
import { SearchFacilitiesDto } from './dto/search-facilities.dto';

/** Total bookable minutes/day used as the denominator for usage_pct (12h). */
const BOOKABLE_MINUTES_PER_DAY = 720;
/** Assumed duration of a fixture slot when computing today's facility usage. */
const FIXTURE_DURATION_MINUTES = 180;
/** Fallback session duration when either start_time or end_time is missing. */
const DEFAULT_SESSION_DURATION_MINUTES = 60;

function todayDateOnly(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

function sessionMinutes(session: {
  start_time: Date | null;
  end_time: Date | null;
}): number {
  if (!session.start_time || !session.end_time) {
    return DEFAULT_SESSION_DURATION_MINUTES;
  }
  const diff =
    (session.end_time.getTime() - session.start_time.getTime()) / 60000;
  return diff > 0 ? diff : DEFAULT_SESSION_DURATION_MINUTES;
}

function toUsagePct(bookedMinutes: number): number {
  const pct = Math.round((bookedMinutes / BOOKABLE_MINUTES_PER_DAY) * 100);
  return Math.min(100, Math.max(0, pct));
}

function toFacilityResponse(facility: sports_facilities, bookedMinutes: number) {
  return {
    id: facility.id,
    name: facility.name,
    location: facility.location,
    facility_type: facility.facility_type,
    capacity: facility.capacity,
    status: facility.status,
    usage_pct: toUsagePct(bookedMinutes),
  };
}

@Injectable()
export class FacilitiesService {
  private readonly logger = new Logger(FacilitiesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/facilities?status=&facility_type= */
  async findAll(dto: SearchFacilitiesDto) {
    const where: Prisma.sports_facilitiesWhereInput = {};
    if (dto.status) where.status = dto.status;
    if (dto.facility_type) where.facility_type = dto.facility_type;

    try {
      const facilities = await this.prisma.sports_facilities.findMany({
        where,
        orderBy: { name: 'asc' },
      });
      const facilityIds = facilities.map((f) => f.id);
      const bookedMinutesByFacility =
        await this.getBookedMinutesToday(facilityIds);
      return facilities.map((facility) =>
        toFacilityResponse(
          facility,
          bookedMinutesByFacility.get(facility.id) ?? 0,
        ),
      );
    } catch (err) {
      this.logger.error('DB error while fetching facilities', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/facilities
   *
   * Error cases:
   *  500 INTERNAL_ERROR – unexpected failure (DB, etc.)
   */
  async create(dto: CreateFacilityDto) {
    try {
      const facility = await this.prisma.sports_facilities.create({
        data: {
          name: dto.name,
          location: dto.location,
          facility_type: dto.facility_type,
          capacity: dto.capacity,
          status: dto.status,
        },
      });
      const bookedMinutes = await this.getBookedMinutesTodayForFacility(
        facility.id,
      );
      return toFacilityResponse(facility, bookedMinutes);
    } catch (err) {
      this.logger.error('DB error while creating facility', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/facilities/:id
   *
   * Error cases:
   *  404 FACILITY_NOT_FOUND – no facility with the given id
   */
  async findOne(id: number) {
    const facility = await this.findById(id);
    if (!facility) {
      throw new NotFoundException({
        message: 'Facility not found',
        errorCode: 'FACILITY_NOT_FOUND',
      });
    }

    const bookedMinutes = await this.getBookedMinutesTodayForFacility(id);
    return toFacilityResponse(facility, bookedMinutes);
  }

  /**
   * PATCH /sports-admin/facilities/:id
   *
   * Error cases:
   *  404 FACILITY_NOT_FOUND – no facility with the given id
   */
  async update(id: number, dto: UpdateFacilityDto) {
    const facility = await this.findById(id);
    if (!facility) {
      throw new NotFoundException({
        message: 'Facility not found',
        errorCode: 'FACILITY_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.sports_facilities.update({
        where: { id },
        data: {
          name: dto.name,
          location: dto.location,
          facility_type: dto.facility_type,
          capacity: dto.capacity,
          status: dto.status,
        },
      });
      const bookedMinutes = await this.getBookedMinutesTodayForFacility(id);
      return toFacilityResponse(updated, bookedMinutes);
    } catch (err) {
      this.logger.error('DB error while updating facility', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/facilities/:id
   *
   * Error cases:
   *  404 FACILITY_NOT_FOUND – no facility with the given id
   */
  async remove(id: number) {
    const facility = await this.findById(id);
    if (!facility) {
      throw new NotFoundException({
        message: 'Facility not found',
        errorCode: 'FACILITY_NOT_FOUND',
      });
    }

    try {
      await this.prisma.sports_facilities.delete({ where: { id } });
      return { message: 'Facility deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting facility', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.sports_facilities.findUnique({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error during facility lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async getBookedMinutesTodayForFacility(
    facilityId: number,
  ): Promise<number> {
    const map = await this.getBookedMinutesToday([facilityId]);
    return map.get(facilityId) ?? 0;
  }

  /** Sums today's training-session + fixture minutes per facility id. */
  private async getBookedMinutesToday(
    facilityIds: number[],
  ): Promise<Map<number, number>> {
    const totals = new Map<number, number>();
    if (facilityIds.length === 0) return totals;

    const today = todayDateOnly();

    const [sessions, fixtures] = await Promise.all([
      this.prisma.sports_training_sessions.findMany({
        where: { facility_id: { in: facilityIds }, session_date: today },
        select: { facility_id: true, start_time: true, end_time: true },
      }),
      this.prisma.sports_fixtures.findMany({
        where: { facility_id: { in: facilityIds }, fixture_date: today },
        select: { facility_id: true },
      }),
    ]);

    for (const session of sessions) {
      if (session.facility_id === null) continue;
      const current = totals.get(session.facility_id) ?? 0;
      totals.set(session.facility_id, current + sessionMinutes(session));
    }

    for (const fixture of fixtures) {
      if (fixture.facility_id === null) continue;
      const current = totals.get(fixture.facility_id) ?? 0;
      totals.set(fixture.facility_id, current + FIXTURE_DURATION_MINUTES);
    }

    return totals;
  }
}
