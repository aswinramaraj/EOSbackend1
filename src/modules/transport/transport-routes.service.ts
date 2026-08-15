import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectTransportSchema } from './transport-schema.util';

interface RouteRow {
  id: number;
  name: string;
  distance_km: string | null;
  boarding_area: string | null;
  departure_time: string | null;
  arrival_time: string | null;
}
interface StageCountRow {
  route_id: number;
  stops_count: bigint;
}
interface StudentFeeRow {
  route_id: number;
  fee_amount: string;
  cnt: bigint;
}
interface BusRow {
  route_id: number;
  bus_no: string;
  vehicle_number: string;
  driver_name: string | null;
  status: string | null;
}

export interface RouteFee {
  /** A single figure only when every enrolled student on this route pays the same amount. */
  per_student: number | null;
  /** Set instead of per_student when enrolled students pay different amounts (different boarding stages). */
  range: { min: number; max: number } | null;
  /** Sum of each enrolled student's own boarding-stage fee — real expected revenue, not stops_count * a guess. */
  total_due: number;
}

function toMap<K, V>(rows: { key: K; value: V }[]): Map<K, V> {
  return new Map(rows.map((r) => [r.key, r.value]));
}

/**
 * Route list for the "Routes" screen. Term fee is deliberately NOT "the
 * most expensive stage on this route" (that overstated what students
 * actually pay — e.g. Route 1's stages range ₹3,000-5,000, but every
 * enrolled student boards at the ₹3,000 stage). It's computed from what
 * enrolled students are actually assigned to pay:
 * student_transport_mapping.boarding_stage_id -> transport_stages.fee_amount,
 * aggregated per route. A route with no enrolled students yet has no fee to
 * report (null), rather than falling back to an unused stage config.
 */
@Injectable()
export class TransportRoutesService {
  private readonly logger = new Logger(TransportRoutesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(search?: string) {
    try {
      const schema = await detectTransportSchema(this.prisma);

      const specSelect = schema.extendedSpecs
        ? Prisma.sql`, distance_km::text AS distance_km, boarding_area, departure_time::text AS departure_time, arrival_time::text AS arrival_time`
        : Prisma.sql`, NULL AS distance_km, NULL AS boarding_area, NULL AS departure_time, NULL AS arrival_time`;
      const routes = await this.prisma.$queryRaw<RouteRow[]>(Prisma.sql`
        SELECT id, name ${specSelect} FROM transport_routes ORDER BY name ASC
      `);

      // Sequential, not Promise.all — the pooled connection is small and shared.
      const stopCounts = await this.prisma.$queryRaw<StageCountRow[]>(Prisma.sql`
        SELECT route_id, COUNT(*)::bigint AS stops_count FROM transport_stages GROUP BY route_id
      `);
      const studentFees = await this.prisma.$queryRaw<StudentFeeRow[]>(Prisma.sql`
        SELECT stm.route_id, ts.fee_amount::text AS fee_amount, COUNT(*)::bigint AS cnt
        FROM student_transport_mapping stm
        JOIN transport_stages ts ON ts.id = stm.boarding_stage_id
        GROUP BY stm.route_id, ts.fee_amount
      `);
      const busSelect = schema.fleetExtras ? Prisma.sql`, status` : Prisma.sql`, NULL AS status`;
      const busRows = await this.prisma.$queryRaw<BusRow[]>(Prisma.sql`
        SELECT route_id, bus_no, vehicle_number, driver_name ${busSelect}
        FROM buses
        WHERE route_id IS NOT NULL
        ORDER BY bus_no ASC
      `);

      const stopCountByRoute = toMap(stopCounts.map((r) => ({ key: r.route_id, value: Number(r.stops_count) })));
      const feesByRoute = new Map<number, StudentFeeRow[]>();
      for (const row of studentFees) {
        const list = feesByRoute.get(row.route_id) ?? [];
        list.push(row);
        feesByRoute.set(row.route_id, list);
      }
      const busesByRoute = new Map<number, BusRow[]>();
      for (const bus of busRows) {
        const list = busesByRoute.get(bus.route_id) ?? [];
        list.push(bus);
        busesByRoute.set(bus.route_id, list);
      }

      let result = routes.map((route) => {
        const buses = busesByRoute.get(route.id) ?? [];
        const feeRows = feesByRoute.get(route.id) ?? [];
        const studentCount = feeRows.reduce((sum, r) => sum + Number(r.cnt), 0);

        let fee: RouteFee = { per_student: null, range: null, total_due: 0 };
        if (feeRows.length > 0) {
          const amounts = feeRows.map((r) => Number(r.fee_amount));
          const totalDue = feeRows.reduce((sum, r) => sum + Number(r.fee_amount) * Number(r.cnt), 0);
          fee =
            feeRows.length === 1
              ? { per_student: amounts[0], range: null, total_due: totalDue }
              : { per_student: null, range: { min: Math.min(...amounts), max: Math.max(...amounts) }, total_due: totalDue };
        }

        return {
          id: route.id,
          name: route.name,
          distance_km: schema.extendedSpecs && route.distance_km != null ? Number(route.distance_km) : null,
          boarding_area: schema.extendedSpecs ? route.boarding_area ?? null : null,
          departure_time: schema.extendedSpecs ? route.departure_time ?? null : null,
          arrival_time: schema.extendedSpecs ? route.arrival_time ?? null : null,
          stops_count: stopCountByRoute.get(route.id) ?? 0,
          fee,
          buses: buses.map((b) => ({
            bus_no: b.bus_no,
            vehicle_number: b.vehicle_number,
            driver_name: b.driver_name,
            status: schema.fleetExtras ? b.status : null,
          })),
          student_count: studentCount,
        };
      });

      if (search?.trim()) {
        const q = search.trim().toLowerCase();
        result = result.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.buses.some(
              (b) => b.bus_no.toLowerCase().includes(q) || b.vehicle_number.toLowerCase().includes(q) || (b.driver_name ?? '').toLowerCase().includes(q),
            ),
        );
      }

      return {
        extended: { fleet_status: schema.fleetExtras, specs: schema.extendedSpecs },
        meta: { total: routes.length, filtered: result.length },
        routes: result,
      };
    } catch (err) {
      this.logger.error('DB error listing routes', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
