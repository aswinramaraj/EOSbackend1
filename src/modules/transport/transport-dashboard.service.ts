import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { TransportDashboardPeriod } from './dto/get-transport-dashboard-query.dto';
import { DOC_TYPE_LABEL, daysBetween, detectTransportSchema } from './transport-schema.util';

interface BaseTotalsRow {
  total_buses: bigint;
  routes_count: bigint;
}
interface FleetStatusRow {
  on_route: bigint;
  at_campus: bigint;
  in_depot: bigint;
  maintenance: bigint;
  total_capacity: bigint;
}
interface RouteRidershipRow {
  route_id: number;
  route_name: string;
  student_count: bigint;
  capacity: bigint;
}
interface CountRow {
  cnt: bigint;
}
interface SumRow {
  total: string | null;
}
interface DocFlagRow {
  bus_no: string;
  doc_type: string;
  valid_until: Date;
}
interface ServiceFlagRow {
  bus_no: string;
  odometer_km: number;
  next_service_due_km: number;
}
interface LicenceFlagRow {
  bus_no: string;
  driver_name: string | null;
  driver_licence_expiry: Date;
}
interface NoticeRow {
  id: number;
  tag: string;
  title: string;
  created_at: Date;
}

/**
 * Transport-office dashboard — every figure is computed from real rows.
 * A handful of tiles (fleet status, capacity/occupancy, service-due,
 * document compliance, notices, diesel cost) depend on schema that doesn't
 * exist in the base install (see the SQL handed to the DB owner alongside
 * this module). `extended` in the response tells the frontend exactly which
 * of those are live so it can render "not tracked yet" instead of a
 * fabricated zero.
 */
@Injectable()
export class TransportDashboardService {
  private readonly logger = new Logger(TransportDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(period: TransportDashboardPeriod = 'today') {
    try {
      // Sequential, not Promise.all — the pooled connection is small and
      // shared (same reasoning as principal-transport/principal-faculty).
      const schema = await detectTransportSchema(this.prisma);
      const fromDate = this.resolvePeriodStart(period);

      const totalsRows = await this.prisma.$queryRaw<BaseTotalsRow[]>(Prisma.sql`
        SELECT
          (SELECT COUNT(*) FROM buses)::bigint AS total_buses,
          (SELECT COUNT(*) FROM transport_routes)::bigint AS routes_count
      `);
      const totals = totalsRows[0];
      const studentsOnTransport = await this.prisma.student_transport_mapping.count();

      const busesReportingRows = await this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(DISTINCT bus_id)::bigint AS cnt FROM bus_live_locations WHERE updated_at >= ${fromDate}
      `);
      const gpsOnlineNowRows = await this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(DISTINCT bus_id)::bigint AS cnt FROM bus_live_locations WHERE updated_at > NOW() - INTERVAL '10 minutes'
      `);
      const transportFeeRows = await this.prisma.$queryRaw<SumRow[]>(Prisma.sql`
        SELECT COALESCE(SUM(fp.amount_paid), 0)::text AS total
        FROM fee_payments fp
        JOIN student_fee_demand_mapping sfdm ON sfdm.id = fp.student_fee_demand_mapping_id
        JOIN fee_structures fs ON fs.id = sfdm.fee_structure_id
        WHERE fs.applies_to = 'transport' AND fp.payment_date >= ${fromDate}
      `);

      let fleetStatus = { on_route: 0, at_campus: 0, in_depot: 0, maintenance: 0 };
      let totalCapacity: number | null = null;
      let routeRidership: RouteRidershipRow[] = [];
      let documentsDue = 0;
      let serviceDue = 0;
      const needsAttention: { title: string; description: string }[] = [];

      if (schema.fleetExtras) {
        const fleetStatusRows = await this.prisma.$queryRaw<FleetStatusRow[]>(Prisma.sql`
          SELECT
            COUNT(*) FILTER (WHERE status = 'on_route')::bigint AS on_route,
            COUNT(*) FILTER (WHERE status = 'at_campus')::bigint AS at_campus,
            COUNT(*) FILTER (WHERE status = 'in_depot')::bigint AS in_depot,
            COUNT(*) FILTER (WHERE status = 'maintenance')::bigint AS maintenance,
            COALESCE(SUM(capacity), 0)::bigint AS total_capacity
          FROM buses
        `);
        const row = fleetStatusRows[0];
        if (row) {
          fleetStatus = {
            on_route: Number(row.on_route),
            at_campus: Number(row.at_campus),
            in_depot: Number(row.in_depot),
            maintenance: Number(row.maintenance),
          };
          totalCapacity = Number(row.total_capacity);
        }

        // Two independent LEFT JOINs (student_transport_mapping and buses,
        // both keyed only on route_id) would form a cross product per route
        // whenever a route has more than one bus, inflating student_count by
        // the bus count. Pre-aggregate each side on its own before joining.
        routeRidership = await this.prisma.$queryRaw<RouteRidershipRow[]>(Prisma.sql`
          SELECT tr.id AS route_id, tr.name AS route_name,
            COALESCE(stm.student_count, 0)::bigint AS student_count,
            COALESCE(bc.capacity, 0)::bigint AS capacity
          FROM transport_routes tr
          LEFT JOIN (
            SELECT route_id, COUNT(*)::bigint AS student_count
            FROM student_transport_mapping
            GROUP BY route_id
          ) stm ON stm.route_id = tr.id
          LEFT JOIN (
            SELECT route_id, SUM(capacity)::bigint AS capacity
            FROM buses
            WHERE route_id IS NOT NULL
            GROUP BY route_id
          ) bc ON bc.route_id = tr.id
          ORDER BY tr.name ASC
        `);

        const serviceDueRows = await this.prisma.$queryRaw<ServiceFlagRow[]>(Prisma.sql`
          SELECT bus_no, odometer_km, next_service_due_km
          FROM buses
          WHERE odometer_km IS NOT NULL AND next_service_due_km IS NOT NULL
            AND odometer_km >= next_service_due_km - 4000
          ORDER BY (next_service_due_km - odometer_km) ASC
          LIMIT 5
        `);
        serviceDue = serviceDueRows.length;
        for (const row of serviceDueRows.slice(0, 2)) {
          const left = row.next_service_due_km - row.odometer_km;
          needsAttention.push({
            title: `${row.bus_no} ${left <= 0 ? 'service overdue' : 'service due soon'} by odometer`,
            description: `Next service at ${row.next_service_due_km.toLocaleString('en-IN')} km · ${Math.max(left, 0).toLocaleString('en-IN')} km left`,
          });
        }

        const licenceRows = await this.prisma.$queryRaw<LicenceFlagRow[]>(Prisma.sql`
          SELECT bus_no, driver_name, driver_licence_expiry
          FROM buses
          WHERE driver_licence_expiry IS NOT NULL AND driver_licence_expiry < CURRENT_DATE + INTERVAL '45 days'
          ORDER BY driver_licence_expiry ASC
          LIMIT 3
        `);
        const now = new Date();
        for (const row of licenceRows.slice(0, 2)) {
          const d = daysBetween(now, row.driver_licence_expiry);
          needsAttention.push({
            title: `${row.driver_name ?? 'Driver'}'s licence ${d < 0 ? `expired ${Math.abs(d)}d ago` : `due in ${d}d`}`,
            description: `Assigned to ${row.bus_no} · renewal at RTO`,
          });
        }

        for (const route of routeRidership) {
          const cap = Number(route.capacity);
          const count = Number(route.student_count);
          if (cap > 0 && count >= cap) {
            needsAttention.push({
              title: `${route.route_name} running full at ${count}/${cap}`,
              description: `${count - cap} student${count - cap === 1 ? '' : 's'} on waiting list`,
            });
            break;
          }
        }
      }

      let dieselToday = 0;
      if (schema.fuelTracking) {
        const dieselRows = await this.prisma.$queryRaw<SumRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(e.amount), 0)::text AS total
          FROM expenses e
          JOIN expense_categories ec ON ec.id = e.category_id
          WHERE ec.name = 'Vehicle Fuel' AND e.expense_date >= ${fromDate}
        `);
        dieselToday = Number(dieselRows[0]?.total ?? 0);
      }

      let notices: NoticeRow[] = [];
      if (schema.notices) {
        notices = await this.prisma.$queryRaw<NoticeRow[]>(Prisma.sql`
          SELECT id, tag, title, created_at FROM transport_notices ORDER BY created_at DESC LIMIT 6
        `);
      }

      if (schema.documents) {
        const docRows = await this.prisma.$queryRaw<DocFlagRow[]>(Prisma.sql`
          SELECT b.bus_no, bd.doc_type, bd.valid_until
          FROM bus_documents bd
          JOIN buses b ON b.id = bd.bus_id
          WHERE bd.valid_until < CURRENT_DATE + INTERVAL '45 days'
          ORDER BY bd.valid_until ASC
          LIMIT 5
        `);
        documentsDue = docRows.length;
        const now = new Date();
        for (const row of docRows.slice(0, 3)) {
          const d = daysBetween(now, row.valid_until);
          const label = DOC_TYPE_LABEL[row.doc_type] ?? row.doc_type;
          needsAttention.unshift({
            title: `${row.bus_no} · ${label} ${d < 0 ? 'expired' : 'due soon'}`,
            description: d < 0 ? `Lapsed ${Math.abs(d)}d ago · vehicle must be grounded` : `Due in ${d}d`,
          });
        }
      }

      const occupancyPercent =
        totalCapacity !== null && totalCapacity > 0
          ? Math.round((studentsOnTransport / totalCapacity) * 100)
          : null;

      return {
        period,
        extended: {
          fleet_status: schema.fleetExtras,
          documents: schema.documents,
          notices: schema.notices,
          fuel_tracking: schema.fuelTracking,
        },
        fleet: {
          total_buses: Number(totals?.total_buses ?? 0),
          buses_on_route: fleetStatus.on_route,
          buses_at_campus: fleetStatus.at_campus,
          buses_in_depot: fleetStatus.in_depot,
          buses_maintenance: fleetStatus.maintenance,
        },
        routes_count: Number(totals?.routes_count ?? 0),
        ridership: {
          students_on_transport: studentsOnTransport,
          total_capacity: totalCapacity,
          occupancy_percent: occupancyPercent,
          routes: routeRidership.map((r) => ({
            route_id: r.route_id,
            route_name: r.route_name,
            student_count: Number(r.student_count),
            capacity: Number(r.capacity) || null,
          })),
        },
        renewals: {
          documents_due: documentsDue,
          service_due: serviceDue,
        },
        fleet_command: {
          buses_reporting: Number(busesReportingRows[0]?.cnt ?? 0),
          gps_online_now: Number(gpsOnlineNowRows[0]?.cnt ?? 0),
          diesel_cost: dieselToday,
          transport_fee_collected: Number(transportFeeRows[0]?.total ?? 0),
          passes_issued: studentsOnTransport,
        },
        needs_attention: needsAttention.slice(0, 5),
        notices: notices.map((n) => ({
          id: n.id,
          tag: n.tag,
          title: n.title,
          created_at: n.created_at,
        })),
      };
    } catch (err) {
      this.logger.error('DB error computing transport dashboard', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * "This term"/"this year" have no fiscal calendar of their own for the
   * transport office (unlike student/faculty, which anchor on one batch's
   * academic_calendars row) — so these are honest rolling windows, not a
   * fabricated semester boundary: today = since midnight, term = trailing
   * 182 days, year = trailing 365 days.
   */
  private resolvePeriodStart(period: TransportDashboardPeriod): Date {
    const now = new Date();
    if (period === 'year') return new Date(now.getTime() - 365 * 86_400_000);
    if (period === 'term') return new Date(now.getTime() - 182 * 86_400_000);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

}
