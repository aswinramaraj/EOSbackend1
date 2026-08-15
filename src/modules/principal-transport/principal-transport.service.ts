import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface RouteRow {
  id: number;
  name: string;
  student_count: bigint;
}
interface BusRow {
  route_id: number;
  bus_no: string;
  vehicle_number: string;
  driver_name: string | null;
}
interface TotalsRow {
  total_buses: bigint;
  buses_assigned: bigint;
  routes_count: bigint;
}

/** Principal-only Transport overview (route, bus, and student count only). */
@Injectable()
export class PrincipalTransportService {
  private readonly logger = new Logger(PrincipalTransportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
      // Sequential, not Promise.all - see principal-faculty/principal-departments
      // services for why (Supabase session-mode pool is small and shared).
      const totalsRows = await this.prisma.$queryRaw<TotalsRow[]>(Prisma.sql`
        SELECT
          (SELECT COUNT(*) FROM buses)::bigint AS total_buses,
          (SELECT COUNT(*) FROM buses WHERE route_id IS NOT NULL)::bigint AS buses_assigned,
          (SELECT COUNT(*) FROM transport_routes)::bigint AS routes_count
      `);

      const studentsOnTransport = await this.prisma.student_transport_mapping.count();

      const routeRows = await this.prisma.$queryRaw<RouteRow[]>(Prisma.sql`
        SELECT tr.id, tr.name,
          (SELECT COUNT(*) FROM student_transport_mapping stm WHERE stm.route_id = tr.id)::bigint AS student_count
        FROM transport_routes tr
        ORDER BY tr.name ASC
      `);

      const busRows = await this.prisma.$queryRaw<BusRow[]>(Prisma.sql`
        SELECT route_id, bus_no, vehicle_number, driver_name
        FROM buses
        WHERE route_id IS NOT NULL
        ORDER BY bus_no ASC
      `);

      const busesByRoute = new Map<number, BusRow[]>();
      for (const bus of busRows) {
        const list = busesByRoute.get(bus.route_id) ?? [];
        list.push(bus);
        busesByRoute.set(bus.route_id, list);
      }

      const totals = totalsRows[0];

      return {
        routes_count: Number(totals?.routes_count ?? 0),
        students_on_transport: studentsOnTransport,
        total_buses: Number(totals?.total_buses ?? 0),
        buses_assigned: Number(totals?.buses_assigned ?? 0),
        routes: routeRows.map((route) => {
          const buses = busesByRoute.get(route.id) ?? [];
          return {
            id: route.id,
            name: route.name,
            student_count: Number(route.student_count),
            buses: buses.map((bus) => ({
              bus_no: bus.bus_no,
              vehicle_number: bus.vehicle_number,
              driver_name: bus.driver_name,
            })),
          };
        }),
      };
    } catch (err) {
      this.logger.error('DB error computing principal transport overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
