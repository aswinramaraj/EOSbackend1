import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectTransportSchema } from './transport-schema.util';
import type { CreateServiceLogDto } from './dto/create-service-log.dto';

interface ServiceDueRow {
  id: number;
  bus_no: string;
  vehicle_number: string;
  odometer_km: number;
  next_service_due_km: number;
}
interface ServiceLogRow {
  id: number;
  bus_id: number;
  bus_no: string;
  service_date: Date;
  work_description: string;
  garage: string | null;
  odometer_km: number | null;
  cost: string | null;
}

/**
 * Maintenance screen — "Service due" is computed live from the extended
 * `buses` columns (odometer_km vs next_service_due_km), same logic the
 * dashboard's renewals tile uses, just returned as a full list here. The
 * "Service & repair log" needs its own history table (bus_service_logs) —
 * not part of the first migration, since the dashboard/buses/routes/crew
 * screens didn't need it; see the SQL handed alongside this feature.
 */
@Injectable()
export class TransportMaintenanceService {
  private readonly logger = new Logger(TransportMaintenanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getMaintenance() {
    try {
      const schema = await detectTransportSchema(this.prisma);

      let serviceDue: ReturnType<typeof this.toServiceDue>[] = [];
      if (schema.fleetExtras) {
        const rows = await this.prisma.$queryRaw<ServiceDueRow[]>(Prisma.sql`
          SELECT id, bus_no, vehicle_number, odometer_km, next_service_due_km
          FROM buses
          WHERE odometer_km IS NOT NULL AND next_service_due_km IS NOT NULL
            AND odometer_km >= next_service_due_km - 4000
          ORDER BY (next_service_due_km - odometer_km) ASC
        `);
        serviceDue = rows.map((r) => this.toServiceDue(r));
      }

      let serviceLog: ServiceLogRow[] = [];
      if (schema.serviceLog) {
        serviceLog = await this.prisma.$queryRaw<ServiceLogRow[]>(Prisma.sql`
          SELECT l.id, l.bus_id, b.bus_no, l.service_date, l.work_description, l.garage, l.odometer_km, l.cost::text AS cost
          FROM bus_service_logs l
          JOIN buses b ON b.id = l.bus_id
          ORDER BY l.service_date DESC, l.id DESC
          LIMIT 50
        `);
      }

      return {
        extended: { fleet_status: schema.fleetExtras, service_log: schema.serviceLog },
        service_due: serviceDue,
        service_log: serviceLog.map((r) => ({
          id: r.id,
          bus_id: r.bus_id,
          bus_no: r.bus_no,
          service_date: r.service_date,
          work_description: r.work_description,
          garage: r.garage,
          odometer_km: r.odometer_km,
          cost: r.cost != null ? Number(r.cost) : null,
        })),
      };
    } catch (err) {
      this.logger.error('DB error loading maintenance data', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async createServiceLogEntry(dto: CreateServiceLogDto, userId: number) {
    const schema = await detectTransportSchema(this.prisma);
    if (!schema.serviceLog) {
      throw new NotFoundException({
        message: 'The bus_service_logs table has not been created yet — see the migration SQL for this feature.',
        errorCode: 'SERVICE_LOG_TABLE_MISSING',
      });
    }

    try {
      const rows = await this.prisma.$queryRaw<ServiceLogRow[]>(Prisma.sql`
        WITH inserted AS (
          INSERT INTO bus_service_logs (bus_id, service_date, work_description, garage, odometer_km, cost, recorded_by_user_id)
          VALUES (
            ${dto.bus_id},
            COALESCE(${dto.service_date ?? null}::date, CURRENT_DATE),
            ${dto.work_description},
            ${dto.garage ?? null},
            ${dto.odometer_km ?? null},
            ${dto.cost ?? null},
            ${userId}
          )
          RETURNING *
        )
        SELECT inserted.id, inserted.bus_id, b.bus_no, inserted.service_date, inserted.work_description,
          inserted.garage, inserted.odometer_km, inserted.cost::text AS cost
        FROM inserted JOIN buses b ON b.id = inserted.bus_id
      `);
      const row = rows[0];
      this.logger.log(`Service log entry created: id=${row?.id} bus=${dto.bus_id} by user=${userId}`);
      return {
        id: row.id,
        bus_id: row.bus_id,
        bus_no: row.bus_no,
        service_date: row.service_date,
        work_description: row.work_description,
        garage: row.garage,
        odometer_km: row.odometer_km,
        cost: row.cost != null ? Number(row.cost) : null,
      };
    } catch (err) {
      this.logger.error('DB error creating service log entry', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private toServiceDue(row: ServiceDueRow) {
    const kmLeft = row.next_service_due_km - row.odometer_km;
    return {
      bus_id: row.id,
      bus_no: row.bus_no,
      vehicle_number: row.vehicle_number,
      odometer_km: row.odometer_km,
      next_service_due_km: row.next_service_due_km,
      km_left: kmLeft,
      tag: kmLeft <= 0 ? ('due' as const) : ('soon' as const),
    };
  }
}
