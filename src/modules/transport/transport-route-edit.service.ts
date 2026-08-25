import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectTransportSchema } from './transport-schema.util';
import { buildDynamicInsert, buildDynamicSet, type DynamicField } from './transport-sql.util';
import type { CreateRouteDto } from './dto/create-route.dto';
import type { UpdateRouteDto } from './dto/update-route.dto';
import type { UpdateStageDto } from './dto/update-stage.dto';
import type { CreateStageDto } from './dto/create-stage.dto';
import type { AddRouteStudentDto } from './dto/add-route-student.dto';

interface RouteRow {
  id: number;
  name: string;
  distance_km: string | null;
  boarding_area: string | null;
  departure_time: string | null;
  arrival_time: string | null;
}
interface StageRow {
  id: number;
  sequence_no: number;
  stage_name: string;
  fee_amount: string;
  pickup_time: string | null;
}
interface RouteStudentRow {
  mapping_id: number;
  student_id_no: string;
  student_name: string;
  boarding_stage_id: number;
  boarding_stage_name: string;
  bus_id: number | null;
  bus_no: string | null;
  fee_amount: string;
}

/**
 * Route + stage editing for the "Routes" screen — lets the transport office
 * enter/correct distance, boarding area, timings, and each stage's fare
 * directly, rather than needing a DB console. Distance/boarding
 * area/timings and per-stop pickup_time only write when their columns
 * exist (extendedSpecs / stageTimes — see transport-schema.util); fee is a
 * base transport_stages column and always writable.
 */
@Injectable()
export class TransportRouteEditService {
  private readonly logger = new Logger(TransportRouteEditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getRouteDetail(routeId: number) {
    const schema = await detectTransportSchema(this.prisma);
    const specSelect = schema.extendedSpecs
      ? Prisma.sql`, distance_km::text AS distance_km, boarding_area, departure_time::text AS departure_time, arrival_time::text AS arrival_time`
      : Prisma.sql`, NULL AS distance_km, NULL AS boarding_area, NULL AS departure_time, NULL AS arrival_time`;
    const routes = await this.prisma.$queryRaw<RouteRow[]>(Prisma.sql`
      SELECT id, name ${specSelect} FROM transport_routes WHERE id = ${routeId}
    `);
    const route = routes[0];
    if (!route) {
      throw new NotFoundException({ message: 'Route not found', errorCode: 'ROUTE_NOT_FOUND' });
    }

    const timeSelect = schema.stageTimes ? Prisma.sql`, pickup_time::text AS pickup_time` : Prisma.sql`, NULL AS pickup_time`;
    const stages = await this.prisma.$queryRaw<StageRow[]>(Prisma.sql`
      SELECT id, sequence_no, stage_name, fee_amount::text AS fee_amount ${timeSelect}
      FROM transport_stages WHERE route_id = ${routeId} ORDER BY sequence_no ASC
    `);

    return {
      extended: { specs: schema.extendedSpecs, stage_times: schema.stageTimes },
      route: {
        id: route.id,
        name: route.name,
        distance_km: schema.extendedSpecs && route.distance_km != null ? Number(route.distance_km) : null,
        boarding_area: schema.extendedSpecs ? route.boarding_area ?? null : null,
        departure_time: schema.extendedSpecs ? route.departure_time ?? null : null,
        arrival_time: schema.extendedSpecs ? route.arrival_time ?? null : null,
      },
      stages: stages.map((s) => ({
        id: s.id,
        sequence_no: s.sequence_no,
        stage_name: s.stage_name,
        fee_amount: Number(s.fee_amount),
        pickup_time: s.pickup_time,
      })),
    };
  }

  /**
   * POST /me/routes — creates a route.
   *
   * Only `name` is guaranteed to exist on every deployment; the optional spec
   * columns are included when this database actually has them, which is why
   * the insert is assembled dynamically like the update below.
   */
  async createRoute(dto: CreateRouteDto) {
    try {
      const schema = await detectTransportSchema(this.prisma);
      const { columns, values } = buildDynamicInsert([
        { column: 'name', value: dto.name },
        { column: 'distance_km', value: dto.distance_km, allowed: schema.extendedSpecs },
        { column: 'boarding_area', value: dto.boarding_area, allowed: schema.extendedSpecs },
        { column: 'departure_time', value: dto.departure_time, allowed: schema.extendedSpecs },
        { column: 'arrival_time', value: dto.arrival_time, allowed: schema.extendedSpecs },
      ]);

      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO transport_routes (${columns}) VALUES (${values}) RETURNING id
      `);
      const id = rows[0].id;
      this.logger.log(`Route created: id=${id} name=${dto.name}`);
      return { id };
    } catch (err) {
      // transport_routes.name is unique — a repeat is the caller's mistake.
      if (
        typeof err === 'object' &&
        err !== null &&
        ((err as { code?: string }).code === 'P2002' ||
          /duplicate key|unique constraint/i.test(String((err as Error).message)))
      ) {
        throw new ConflictException({
          message: 'A route with that name already exists',
          errorCode: 'ROUTE_NAME_TAKEN',
        });
      }
      this.logger.error('DB error creating route', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  /**
   * DELETE /me/routes/:id
   *
   * Refused while buses are assigned or students are still mapped to the
   * route. Deleting anyway would cascade the stages away and silently strip
   * those students of their transport record (and the fare attached to it),
   * so the caller is told what to detach first.
   */
  async deleteRoute(routeId: number) {
    try {
      const [buses, students] = await Promise.all([
        this.prisma.buses.count({ where: { route_id: routeId } }),
        this.prisma.student_transport_mapping.count({ where: { route_id: routeId } }),
      ]);

      if (buses > 0 || students > 0) {
        const parts: string[] = [];
        if (buses > 0) parts.push(`${buses} bus(es)`);
        if (students > 0) parts.push(`${students} student(s)`);
        throw new ConflictException({
          message: `This route still has ${parts.join(' and ')} assigned. Reassign them before deleting it.`,
          errorCode: 'ROUTE_IN_USE',
        });
      }

      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        DELETE FROM transport_routes WHERE id = ${routeId} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({ message: 'Route not found', errorCode: 'ROUTE_NOT_FOUND' });
      }
      this.logger.log(`Route deleted: id=${routeId}`);
      return { id: routeId, message: 'Route deleted successfully' };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ConflictException) throw err;
      this.logger.error('DB error deleting route', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  /**
   * DELETE /me/stages/:id — removes a boarding stage.
   *
   * Blocked while students board or alight there, and while a fee structure
   * item points at it, since either would leave a dangling fare reference.
   */
  async deleteStage(stageId: number) {
    try {
      const [boarding, destination, feeItems] = await Promise.all([
        this.prisma.student_transport_mapping.count({ where: { boarding_stage_id: stageId } }),
        this.prisma.student_transport_mapping.count({ where: { destination_stage_id: stageId } }),
        this.prisma.fee_structure_items.count({ where: { transport_stage_id: stageId } }),
      ]);

      const riders = boarding + destination;
      if (riders > 0 || feeItems > 0) {
        const parts: string[] = [];
        if (riders > 0) parts.push(`${riders} student assignment(s)`);
        if (feeItems > 0) parts.push(`${feeItems} fee structure item(s)`);
        throw new ConflictException({
          message: `This stage is still referenced by ${parts.join(' and ')}. Move them before deleting it.`,
          errorCode: 'STAGE_IN_USE',
        });
      }

      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        DELETE FROM transport_stages WHERE id = ${stageId} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({ message: 'Stage not found', errorCode: 'STAGE_NOT_FOUND' });
      }
      this.logger.log(`Stage deleted: id=${stageId}`);
      return { id: stageId, message: 'Stage deleted successfully' };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ConflictException) throw err;
      this.logger.error('DB error deleting stage', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async updateRoute(routeId: number, dto: UpdateRouteDto) {
    try {
      const schema = await detectTransportSchema(this.prisma);
      const fields: DynamicField[] = [
        { column: 'name', value: dto.name },
        { column: 'distance_km', value: dto.distance_km, allowed: schema.extendedSpecs },
        { column: 'boarding_area', value: dto.boarding_area, allowed: schema.extendedSpecs },
        { column: 'departure_time', value: dto.departure_time, allowed: schema.extendedSpecs },
        { column: 'arrival_time', value: dto.arrival_time, allowed: schema.extendedSpecs },
      ];
      const setClause = buildDynamicSet(fields);
      if (!setClause) {
        throw new BadRequestException({ message: 'No fields provided to update', errorCode: 'VALIDATION_ERROR' });
      }

      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE transport_routes SET ${setClause} WHERE id = ${routeId} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({ message: 'Route not found', errorCode: 'ROUTE_NOT_FOUND' });
      }
      this.logger.log(`Route updated: id=${routeId}`);
      return { id: routeId };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error('DB error updating route', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async updateStage(stageId: number, dto: UpdateStageDto) {
    try {
      const schema = await detectTransportSchema(this.prisma);
      const fields: DynamicField[] = [
        { column: 'stage_name', value: dto.stage_name },
        { column: 'fee_amount', value: dto.fee_amount },
        { column: 'sequence_no', value: dto.sequence_no },
        { column: 'pickup_time', value: dto.pickup_time, allowed: schema.stageTimes },
      ];
      const setClause = buildDynamicSet(fields);
      if (!setClause) {
        throw new BadRequestException({ message: 'No fields provided to update', errorCode: 'VALIDATION_ERROR' });
      }

      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE transport_stages SET ${setClause} WHERE id = ${stageId} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({ message: 'Stage not found', errorCode: 'STAGE_NOT_FOUND' });
      }
      this.logger.log(`Stage updated: id=${stageId}`);
      return { id: stageId };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error('DB error updating stage', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async createStage(routeId: number, dto: CreateStageDto) {
    try {
      const schema = await detectTransportSchema(this.prisma);
      const routeExists = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        SELECT id FROM transport_routes WHERE id = ${routeId}
      `);
      if (routeExists.length === 0) {
        throw new NotFoundException({ message: 'Route not found', errorCode: 'ROUTE_NOT_FOUND' });
      }

      const timeSelect = schema.stageTimes ? Prisma.sql`, pickup_time` : Prisma.empty;
      const timeValue = schema.stageTimes ? Prisma.sql`, ${dto.pickup_time ?? null}` : Prisma.empty;

      const rows = await this.prisma.$queryRaw<StageRow[]>(Prisma.sql`
        WITH next_seq AS (
          SELECT COALESCE(MAX(sequence_no), 0) + 1 AS seq FROM transport_stages WHERE route_id = ${routeId}
        )
        INSERT INTO transport_stages (route_id, sequence_no, stage_name, fee_amount ${timeSelect})
        SELECT ${routeId}, next_seq.seq, ${dto.stage_name}, ${dto.fee_amount} ${timeValue}
        FROM next_seq
        RETURNING id, sequence_no, stage_name, fee_amount::text AS fee_amount, ${schema.stageTimes ? Prisma.sql`pickup_time::text AS pickup_time` : Prisma.sql`NULL AS pickup_time`}
      `);
      const stage = rows[0];
      this.logger.log(`Stage created: id=${stage.id} route=${routeId}`);
      return {
        id: stage.id,
        sequence_no: stage.sequence_no,
        stage_name: stage.stage_name,
        fee_amount: Number(stage.fee_amount),
        pickup_time: stage.pickup_time,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error creating stage', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  /** GET /me/routes/:id/students — every student currently assigned to this route. */
  async getRouteStudents(routeId: number) {
    const rows = await this.prisma.$queryRaw<RouteStudentRow[]>(Prisma.sql`
      SELECT stm.id AS mapping_id, s.student_id_no,
        COALESCE(NULLIF(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))), ''), u.email) AS student_name,
        stm.boarding_stage_id, ts.stage_name AS boarding_stage_name,
        stm.bus_id, b.bus_no,
        ts.fee_amount::text AS fee_amount
      FROM student_transport_mapping stm
      JOIN students s ON s.id = stm.student_id
      JOIN transport_stages ts ON ts.id = stm.boarding_stage_id
      LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
      JOIN users u ON u.id = s.user_id
      LEFT JOIN buses b ON b.id = stm.bus_id
      WHERE stm.route_id = ${routeId}
      ORDER BY s.student_id_no ASC
    `);
    return rows.map((r) => ({
      mapping_id: r.mapping_id,
      student_id_no: r.student_id_no,
      student_name: r.student_name,
      boarding_stage_id: r.boarding_stage_id,
      boarding_stage_name: r.boarding_stage_name,
      bus_id: r.bus_id,
      bus_no: r.bus_no,
      fee_amount: Number(r.fee_amount),
    }));
  }

  /**
   * POST /me/routes/:id/students — add a student (by their student ID) to
   * this route's boarding stage. student_transport_mapping.student_id is
   * unique — a student can only have one transport assignment at all, so
   * this is an upsert: a student already assigned elsewhere gets moved
   * here rather than erroring. destination_stage_id is always the route's
   * own last stage by sequence order (confirmed from existing data — it's
   * never a separate "campus" stage), not something the caller chooses.
   */
  async addOrMoveStudent(routeId: number, dto: AddRouteStudentDto) {
    try {
      const student = await this.prisma.students.findUnique({
        where: { student_id_no: dto.student_id_no },
        select: { id: true },
      });
      if (!student) {
        throw new NotFoundException({ message: `No student found with ID ${dto.student_id_no}`, errorCode: 'STUDENT_NOT_FOUND' });
      }

      const stage = await this.prisma.transport_stages.findUnique({ where: { id: dto.boarding_stage_id } });
      if (!stage || stage.route_id !== routeId) {
        throw new BadRequestException({ message: "This boarding stage does not belong to this route", errorCode: 'STAGE_ROUTE_MISMATCH' });
      }

      const lastStage = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        SELECT id FROM transport_stages WHERE route_id = ${routeId} ORDER BY sequence_no DESC LIMIT 1
      `);
      const destinationStageId = lastStage[0]?.id ?? dto.boarding_stage_id;

      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO student_transport_mapping (student_id, route_id, boarding_stage_id, destination_stage_id, bus_id)
        VALUES (${student.id}, ${routeId}, ${dto.boarding_stage_id}, ${destinationStageId}, ${dto.bus_id ?? null})
        ON CONFLICT (student_id) DO UPDATE SET
          route_id = EXCLUDED.route_id,
          boarding_stage_id = EXCLUDED.boarding_stage_id,
          destination_stage_id = EXCLUDED.destination_stage_id,
          bus_id = EXCLUDED.bus_id
        RETURNING id
      `);
      this.logger.log(`Student ${dto.student_id_no} assigned to route=${routeId} stage=${dto.boarding_stage_id}`);
      return { mapping_id: rows[0].id };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error('DB error assigning student to route', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  /** DELETE /me/routes/:id/students/:mappingId — remove a student's transport assignment. */
  async removeStudent(routeId: number, mappingId: number) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        DELETE FROM student_transport_mapping WHERE id = ${mappingId} AND route_id = ${routeId} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({ message: 'Student assignment not found on this route', errorCode: 'MAPPING_NOT_FOUND' });
      }
      this.logger.log(`Student transport mapping removed: id=${mappingId}`);
      return { id: mappingId };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error removing student transport mapping', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
