import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { DOC_TYPE_LABEL, daysBetween, detectTransportSchema } from './transport-schema.util';
import type { ListBusesQueryDto } from './dto/list-buses-query.dto';

interface BaseBusRow {
  id: number;
  bus_no: string;
  vehicle_number: string;
  driver_name: string | null;
  gps_device_id: string | null;
  route_id: number | null;
  route_name: string | null;
  last_seen: Date | null;
}
interface ExtendedBusRow extends BaseBusRow {
  status: string;
  capacity: number | null;
  driver_phone: string | null;
  driver_licence_no: string | null;
  driver_licence_expiry: Date | null;
  attendant_name: string | null;
  attendant_phone: string | null;
  odometer_km: number | null;
  next_service_due_km: number | null;
}
interface SpecRow {
  model: string | null;
  distance_km: string | null;
  boarding_area: string | null;
  departure_time: string | null;
  arrival_time: string | null;
}
interface RouteAggRow {
  route_id: number;
  cnt: bigint;
}
interface BusAggRow {
  bus_id: number;
  cnt: bigint;
}
interface StatusCountRow {
  status: string;
  cnt: bigint;
}
interface DocRow {
  bus_id: number;
  doc_type: string;
  valid_until: Date;
}

function toMap(rows: RouteAggRow[]): Map<number, number> {
  return new Map(rows.map((r) => [r.route_id, Number(r.cnt)]));
}
function toBusMap(rows: BusAggRow[]): Map<number, number> {
  return new Map(rows.map((r) => [r.bus_id, Number(r.cnt)]));
}

/**
 * Fleet list for the "Buses" screen — every field is a real column/count.
 * Fields that depend on extended schema (status, capacity, service, driver
 * licence, compliance, model/distance, per-bus ridership) come back null
 * when that schema hasn't been applied yet (see transport-schema.util) —
 * the frontend renders those as "not tracked yet", never a fabricated value.
 *
 * Ridership: `student_transport_mapping` only had `route_id` originally, so
 * when a route has more than one bus there was no way to say which bus a
 * given student actually rides — occupancy could only be shown shared
 * across the route's buses. `student_transport_mapping.bus_id` (optional,
 * nullable) lets ridership be counted per bus once assignments exist;
 * students still missing a bus_id keep counting toward the route-shared
 * total instead of vanishing.
 */
@Injectable()
export class TransportBusesService {
  private readonly logger = new Logger(TransportBusesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListBusesQueryDto) {
    try {
      const schema = await detectTransportSchema(this.prisma);
      const search = query.search?.trim();

      const conditions: Prisma.Sql[] = [];
      if (schema.fleetExtras && query.status) {
        conditions.push(Prisma.sql`b.status = ${query.status}`);
      }
      if (search) {
        const like = `%${search}%`;
        conditions.push(
          Prisma.sql`(b.bus_no ILIKE ${like} OR b.vehicle_number ILIKE ${like} OR COALESCE(b.driver_name, '') ILIKE ${like} OR COALESCE(tr.name, '') ILIKE ${like})`,
        );
      }
      const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

      const extraSelect = schema.fleetExtras
        ? Prisma.sql`, b.status, b.capacity, b.driver_phone, b.driver_licence_no, b.driver_licence_expiry, b.attendant_name, b.attendant_phone, b.odometer_km, b.next_service_due_km`
        : Prisma.empty;
      const specSelect = schema.extendedSpecs
        ? Prisma.sql`, b.model, tr.distance_km::text AS distance_km, tr.boarding_area, tr.departure_time::text AS departure_time, tr.arrival_time::text AS arrival_time`
        : Prisma.empty;

      const rows = await this.prisma.$queryRaw<(BaseBusRow & Partial<ExtendedBusRow> & Partial<SpecRow>)[]>(Prisma.sql`
        SELECT b.id, b.bus_no, b.vehicle_number, b.driver_name, b.gps_device_id, b.route_id, tr.name AS route_name,
          ll.last_seen
          ${extraSelect}
          ${specSelect}
        FROM buses b
        LEFT JOIN transport_routes tr ON tr.id = b.route_id
        LEFT JOIN LATERAL (
          SELECT MAX(updated_at) AS last_seen FROM bus_live_locations WHERE bus_id = b.id
        ) ll ON true
        ${whereClause}
        ORDER BY b.bus_no ASC
      `);

      // Sequential, not Promise.all — the pooled connection is small and shared.
      const totalBuses = await this.prisma.buses.count();

      const routeBusCountRows = await this.prisma.$queryRaw<RouteAggRow[]>(Prisma.sql`
        SELECT route_id, COUNT(*)::bigint AS cnt FROM buses WHERE route_id IS NOT NULL GROUP BY route_id
      `);
      const routeStopCountRows = await this.prisma.$queryRaw<RouteAggRow[]>(Prisma.sql`
        SELECT route_id, COUNT(*)::bigint AS cnt FROM transport_stages GROUP BY route_id
      `);
      const routeStudentCountRows = await this.prisma.$queryRaw<RouteAggRow[]>(Prisma.sql`
        SELECT route_id, COUNT(*)::bigint AS cnt FROM student_transport_mapping GROUP BY route_id
      `);
      const routeBusCounts = toMap(routeBusCountRows);
      const routeStopCounts = toMap(routeStopCountRows);
      const routeStudentCounts = toMap(routeStudentCountRows);

      let busRidershipCounts = new Map<number, number>();
      if (schema.perBusRidership) {
        const busRidershipRows = await this.prisma.$queryRaw<BusAggRow[]>(Prisma.sql`
          SELECT bus_id, COUNT(*)::bigint AS cnt FROM student_transport_mapping WHERE bus_id IS NOT NULL GROUP BY bus_id
        `);
        busRidershipCounts = toBusMap(busRidershipRows);
      }

      let statusCounts: Record<string, number> | null = null;
      if (schema.fleetExtras) {
        const statusCountRows = await this.prisma.$queryRaw<StatusCountRow[]>(Prisma.sql`
          SELECT status, COUNT(*)::bigint AS cnt FROM buses GROUP BY status
        `);
        statusCounts = { on_route: 0, at_campus: 0, in_depot: 0, maintenance: 0 };
        for (const row of statusCountRows) {
          statusCounts[row.status] = Number(row.cnt);
        }
      }

      const docByBus = new Map<number, DocRow>();
      if (schema.documents) {
        const docRows = await this.prisma.$queryRaw<DocRow[]>(Prisma.sql`
          SELECT bus_id, doc_type, valid_until FROM bus_documents ORDER BY valid_until ASC
        `);
        for (const row of docRows) {
          if (!docByBus.has(row.bus_id)) docByBus.set(row.bus_id, row);
        }
      }

      const now = new Date();
      const buses = rows.map((row) => {
        const routeId = row.route_id;
        const doc = docByBus.get(row.id);
        const serviceDue =
          schema.fleetExtras && row.odometer_km != null && row.next_service_due_km != null
            ? row.odometer_km >= row.next_service_due_km - 4000
            : null;

        const exactRidership = schema.perBusRidership ? busRidershipCounts.get(row.id) ?? 0 : null;
        const sharedRidership = routeId ? routeStudentCounts.get(routeId) ?? 0 : 0;
        const ridershipCount = exactRidership ?? sharedRidership;
        const capacity = schema.fleetExtras ? row.capacity ?? null : null;

        return {
          id: row.id,
          bus_no: row.bus_no,
          vehicle_number: row.vehicle_number,
          driver_name: row.driver_name,
          driver_phone: schema.fleetExtras ? row.driver_phone ?? null : null,
          gps_device_id: row.gps_device_id,
          status: schema.fleetExtras ? row.status ?? null : null,
          capacity,
          model: schema.extendedSpecs ? row.model ?? null : null,
          ridership: {
            count: ridershipCount,
            exact: exactRidership !== null,
            seats_free: capacity != null ? capacity - ridershipCount : null,
          },
          route: routeId
            ? {
                id: routeId,
                name: row.route_name,
                bus_count: routeBusCounts.get(routeId) ?? 1,
                stops_count: routeStopCounts.get(routeId) ?? 0,
                student_count: sharedRidership,
                distance_km: schema.extendedSpecs && row.distance_km != null ? Number(row.distance_km) : null,
                boarding_area: schema.extendedSpecs ? row.boarding_area ?? null : null,
                departure_time: schema.extendedSpecs ? row.departure_time ?? null : null,
                arrival_time: schema.extendedSpecs ? row.arrival_time ?? null : null,
              }
            : null,
          gps: {
            online: row.last_seen ? now.getTime() - row.last_seen.getTime() < 10 * 60_000 : false,
            last_seen: row.last_seen,
          },
          odometer_km: schema.fleetExtras ? row.odometer_km ?? null : null,
          next_service_due_km: schema.fleetExtras ? row.next_service_due_km ?? null : null,
          service_due: serviceDue,
          document: doc
            ? {
                label: DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type,
                valid_until: doc.valid_until,
                state: daysBetween(now, doc.valid_until) < 0 ? 'expired' : daysBetween(now, doc.valid_until) < 45 ? 'due_soon' : 'valid',
              }
            : null,
        };
      });

      return {
        extended: {
          fleet_status: schema.fleetExtras,
          documents: schema.documents,
          specs: schema.extendedSpecs,
          per_bus_ridership: schema.perBusRidership,
        },
        meta: {
          total: totalBuses,
          filtered: buses.length,
        },
        status_counts: statusCounts,
        buses,
      };
    } catch (err) {
      this.logger.error('DB error listing buses', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
