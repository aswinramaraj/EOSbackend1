import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { daysBetween, detectTransportSchema } from './transport-schema.util';

interface BaseCrewRow {
  bus_id: number;
  bus_no: string;
  vehicle_number: string;
  route_name: string | null;
  driver_name: string | null;
}
interface ExtendedCrewRow extends BaseCrewRow {
  driver_phone: string | null;
  driver_licence_no: string | null;
  driver_licence_expiry: Date | null;
  attendant_name: string | null;
  attendant_phone: string | null;
}
interface SpecCrewRow {
  driver_experience_years: number | null;
  driver_blood_group: string | null;
}

/**
 * Drivers & crew — there is no standalone driver/attendant entity in the
 * schema, only free-text fields on `buses` (one driver + one attendant per
 * bus). So this is "who's assigned to each bus", not an HR roster; two buses
 * with the same driver name show as two separate rows since there's no
 * driver_id to dedupe on. Licence no/expiry/phone/attendant fields need the
 * `fleetExtras` columns; experience/blood group need `vehicleSpecs` on top
 * of that (added later, for the bus-detail crew card — see
 * transport-schema.util).
 */
@Injectable()
export class TransportCrewService {
  private readonly logger = new Logger(TransportCrewService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(search?: string) {
    try {
      const schema = await detectTransportSchema(this.prisma);

      const conditions: Prisma.Sql[] = [];
      if (search?.trim()) {
        const like = `%${search.trim()}%`;
        const licenceCond = schema.fleetExtras ? Prisma.sql` OR COALESCE(b.driver_licence_no, '') ILIKE ${like} OR COALESCE(b.attendant_name, '') ILIKE ${like}` : Prisma.empty;
        conditions.push(
          Prisma.sql`(COALESCE(b.driver_name, '') ILIKE ${like} OR b.bus_no ILIKE ${like} OR b.vehicle_number ILIKE ${like}${licenceCond})`,
        );
      }
      const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

      const extraSelect = schema.fleetExtras
        ? Prisma.sql`, b.driver_phone, b.driver_licence_no, b.driver_licence_expiry, b.attendant_name, b.attendant_phone`
        : Prisma.empty;
      const specSelect = schema.vehicleSpecs ? Prisma.sql`, b.driver_experience_years, b.driver_blood_group` : Prisma.empty;

      const rows = await this.prisma.$queryRaw<(BaseCrewRow & Partial<ExtendedCrewRow> & Partial<SpecCrewRow>)[]>(Prisma.sql`
        SELECT b.id AS bus_id, b.bus_no, b.vehicle_number, tr.name AS route_name, b.driver_name
          ${extraSelect}
          ${specSelect}
        FROM buses b
        LEFT JOIN transport_routes tr ON tr.id = b.route_id
        ${whereClause}
        ORDER BY b.bus_no ASC
      `);
      // Sequential, not Promise.all — the pooled connection is small and shared.
      const totalBuses = await this.prisma.buses.count();

      const now = new Date();
      const crew = rows.map((row) => {
        const licenceExpiry = schema.fleetExtras ? row.driver_licence_expiry ?? null : null;
        const licenceState = licenceExpiry
          ? daysBetween(now, licenceExpiry) < 0
            ? 'expired'
            : daysBetween(now, licenceExpiry) < 45
              ? 'due_soon'
              : 'valid'
          : null;

        return {
          bus_id: row.bus_id,
          bus_no: row.bus_no,
          vehicle_number: row.vehicle_number,
          route_name: row.route_name,
          driver_name: row.driver_name,
          driver_phone: schema.fleetExtras ? row.driver_phone ?? null : null,
          driver_licence_no: schema.fleetExtras ? row.driver_licence_no ?? null : null,
          driver_licence_expiry: licenceExpiry,
          licence_state: licenceState,
          attendant_name: schema.fleetExtras ? row.attendant_name ?? null : null,
          attendant_phone: schema.fleetExtras ? row.attendant_phone ?? null : null,
          driver_experience_years: schema.vehicleSpecs ? row.driver_experience_years ?? null : null,
          driver_blood_group: schema.vehicleSpecs ? row.driver_blood_group ?? null : null,
        };
      });

      return {
        extended: { fleet_status: schema.fleetExtras, vehicle_specs: schema.vehicleSpecs },
        meta: { total: totalBuses, filtered: crew.length },
        crew,
      };
    } catch (err) {
      this.logger.error('DB error listing crew', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
