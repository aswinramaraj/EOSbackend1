import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AddTransportStageDto } from './dto/add-transport-stage.dto';
import { CreateTransportRouteDto } from './dto/create-transport-route.dto';
import { UpdateTransportRouteDto } from './dto/update-transport-route.dto';

@Injectable()
export class TransportRouteService {
  private readonly logger = new Logger(TransportRouteService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /transport-routes
   *
   * Error cases:
   *  409 TRANSPORT_ROUTE_EXISTS – a route with the same name already exists
   *  500 INTERNAL_ERROR         – unexpected failure (DB, etc.)
   */
  async create(dto: CreateTransportRouteDto) {
    const existing = await this.findByName(dto.name);

    if (existing) {
      throw new ConflictException({
        message: 'A transport route with this name already exists',
        errorCode: 'TRANSPORT_ROUTE_EXISTS',
      });
    }

    try {
      return await this.prisma.transport_routes.create({
        data: { name: dto.name },
      });
    } catch (err) {
      this.logger.error('DB error while creating transport route', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /transport-routes
   */
  async findAll() {
    try {
      return await this.prisma.transport_routes.findMany({
        orderBy: { name: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching transport routes', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /transport-routes/:id
   *
   * Error cases:
   *  404 TRANSPORT_ROUTE_NOT_FOUND – no route with the given id
   */
  async findOne(id: number) {
    const route = await this.findById(id);

    if (!route) {
      throw new NotFoundException({
        message: 'Transport route not found',
        errorCode: 'TRANSPORT_ROUTE_NOT_FOUND',
      });
    }

    return route;
  }

  /**
   * PUT/PATCH /transport-routes/:id
   *
   * Error cases:
   *  404 TRANSPORT_ROUTE_NOT_FOUND – no route with the given id
   *  409 TRANSPORT_ROUTE_EXISTS    – another route already uses this name
   */
  async update(id: number, dto: UpdateTransportRouteDto) {
    const route = await this.findById(id);

    if (!route) {
      throw new NotFoundException({
        message: 'Transport route not found',
        errorCode: 'TRANSPORT_ROUTE_NOT_FOUND',
      });
    }

    if (dto.name) {
      const existing = await this.findByName(dto.name);

      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A transport route with this name already exists',
          errorCode: 'TRANSPORT_ROUTE_EXISTS',
        });
      }
    }

    try {
      return await this.prisma.transport_routes.update({
        where: { id },
        data: { name: dto.name },
      });
    } catch (err) {
      this.logger.error('DB error while updating transport route', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /transport-routes/:id
   *
   * Error cases:
   *  404 TRANSPORT_ROUTE_NOT_FOUND – no route with the given id
   *  409 TRANSPORT_ROUTE_IN_USE    – route is referenced by transport_stages, buses or student_transport_mapping
   */
  async remove(id: number) {
    const route = await this.findById(id);

    if (!route) {
      throw new NotFoundException({
        message: 'Transport route not found',
        errorCode: 'TRANSPORT_ROUTE_NOT_FOUND',
      });
    }

    let usageCounts: number[];

    try {
      usageCounts = await Promise.all([
        this.prisma.transport_stages.count({ where: { route_id: id } }),
        this.prisma.buses.count({ where: { route_id: id } }),
        this.prisma.student_transport_mapping.count({
          where: { route_id: id },
        }),
      ]);
    } catch (err) {
      this.logger.error('DB error while checking transport route usage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (usageCounts.some((count) => count > 0)) {
      throw new ConflictException({
        message: 'This transport route is in use and cannot be deleted',
        errorCode: 'TRANSPORT_ROUTE_IN_USE',
      });
    }

    try {
      return await this.prisma.transport_routes.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting transport route', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /transport-routes/:id/stages
   *
   * Error cases:
   *  404 TRANSPORT_ROUTE_NOT_FOUND    – no route with the given id
   *  409 TRANSPORT_STAGE_EXISTS       – a stage with the same sequence_no already exists for this route
   *  500 INTERNAL_ERROR               – unexpected failure (DB, etc.)
   */
  async addStage(routeId: number, dto: AddTransportStageDto) {
    const route = await this.findById(routeId);

    if (!route) {
      throw new NotFoundException({
        message: 'Transport route not found',
        errorCode: 'TRANSPORT_ROUTE_NOT_FOUND',
      });
    }

    let existingStage: unknown;

    try {
      existingStage = await this.prisma.transport_stages.findUnique({
        where: {
          route_id_sequence_no: {
            route_id: routeId,
            sequence_no: dto.sequence_no,
          },
        },
      });
    } catch (err) {
      this.logger.error('DB error during transport stage duplicate check', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (existingStage) {
      throw new ConflictException({
        message:
          'A stage with this sequence number already exists for this route',
        errorCode: 'TRANSPORT_STAGE_EXISTS',
      });
    }

    try {
      return await this.prisma.transport_stages.create({
        data: {
          route_id: routeId,
          stage_name: dto.stage_name,
          sequence_no: dto.sequence_no,
          fee_amount: dto.fee_amount,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating transport stage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findByName(name: string) {
    try {
      return await this.prisma.transport_routes.findUnique({ where: { name } });
    } catch (err) {
      this.logger.error('DB error during transport route duplicate check', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.transport_routes.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during transport route lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
