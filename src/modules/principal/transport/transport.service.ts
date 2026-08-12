import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function formatTime(date: Date | null): string | null {
  if (!date) return null;
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

@Injectable()
export class PrincipalTransportService {
  constructor(private readonly prisma: PrismaService) {}

  private async buildFleet() {
    const [buses, mappings, lastSeenRows, allStages] = await Promise.all([
      this.prisma.buses.findMany({
        select: {
          id: true,
          bus_no: true,
          vehicle_number: true,
          driver_name: true,
          driver_phone: true,
          capacity: true,
          status: true,
          route_id: true,
          transport_routes: {
            select: {
              id: true,
              name: true,
              departure_time: true,
              arrival_time: true,
            },
          },
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.student_transport_mapping.findMany({
        select: { id: true, route_id: true, bus_id: true },
      }),
      this.prisma.bus_live_locations.findMany({
        select: { bus_id: true, updated_at: true },
        orderBy: { updated_at: 'desc' },
      }),
      this.prisma.transport_stages.findMany({
        select: { route_id: true, sequence_no: true, stage_name: true },
        orderBy: { sequence_no: 'asc' },
      }),
    ]);

    const stopsByRoute = new Map<
      number,
      { sequence_no: number; stage_name: string }[]
    >();
    for (const stage of allStages) {
      const list = stopsByRoute.get(stage.route_id) ?? [];
      list.push(stage);
      stopsByRoute.set(stage.route_id, list);
    }
    const stopsCountByRoute = new Map(
      Array.from(stopsByRoute.entries()).map(([routeId, stops]) => [
        routeId,
        stops.length,
      ]),
    );
    const endpointsByRoute = new Map(
      Array.from(stopsByRoute.entries()).map(([routeId, stops]) => [
        routeId,
        {
          first_stop: stops[0]?.stage_name ?? null,
          last_stop: stops[stops.length - 1]?.stage_name ?? null,
        },
      ]),
    );
    const lastSeenByBus = new Map<number, Date>();
    for (const row of lastSeenRows) {
      if (!lastSeenByBus.has(row.bus_id))
        lastSeenByBus.set(row.bus_id, row.updated_at);
    }
    const busesPerRoute = new Map<number, number>();
    for (const b of buses) {
      if (b.route_id == null) continue;
      busesPerRoute.set(b.route_id, (busesPerRoute.get(b.route_id) ?? 0) + 1);
    }

    return buses.map((bus) => {
      const busesOnThisRoute =
        bus.route_id == null ? 0 : (busesPerRoute.get(bus.route_id) ?? 0);
      const ridersCount =
        busesOnThisRoute <= 1
          ? mappings.filter((m) => m.route_id === bus.route_id).length
          : mappings.filter((m) => m.bus_id === bus.id).length;

      const seatsFree =
        bus.capacity != null ? bus.capacity - ridersCount : null;

      return {
        id: bus.id,
        bus_no: bus.bus_no,
        vehicle_number: bus.vehicle_number,
        status: bus.status,
        route: bus.transport_routes
          ? {
              id: bus.transport_routes.id,
              name: bus.transport_routes.name,
              stops_count: stopsCountByRoute.get(bus.route_id!) ?? 0,
              first_stop:
                endpointsByRoute.get(bus.route_id!)?.first_stop ?? null,
              last_stop: endpointsByRoute.get(bus.route_id!)?.last_stop ?? null,
              departure_time: formatTime(bus.transport_routes.departure_time),
              arrival_time: formatTime(bus.transport_routes.arrival_time),
            }
          : null,
        driver_name: bus.driver_name,
        driver_phone: bus.driver_phone,
        capacity: bus.capacity,
        riders_count: ridersCount,
        seats_free: seatsFree,
        last_seen: lastSeenByBus.get(bus.id)?.toISOString() ?? null,
      };
    });
  }

  /** GET /me/principal/transport */
  async list() {
    const buses = await this.buildFleet();
    return { total: buses.length, buses };
  }

  /** GET /me/principal/transport/:id */
  async findOne(id: number) {
    const fleet = await this.buildFleet();
    const bus = fleet.find((b) => b.id === id);
    if (!bus) {
      throw new NotFoundException({
        message: 'Bus not found',
        errorCode: 'BUS_NOT_FOUND',
      });
    }

    const busRow = await this.prisma.buses.findUnique({
      where: { id },
      select: { route_id: true },
    });
    const stops = busRow?.route_id
      ? await this.prisma.transport_stages.findMany({
          where: { route_id: busRow.route_id },
          orderBy: { sequence_no: 'asc' },
          select: {
            id: true,
            sequence_no: true,
            stage_name: true,
            fee_amount: true,
            pickup_time: true,
          },
        })
      : [];

    return {
      ...bus,
      stops: stops.map((s) => ({
        id: s.id,
        sequence_no: s.sequence_no,
        stage_name: s.stage_name,
        fee_amount: Number(s.fee_amount),
        pickup_time: formatTime(s.pickup_time),
      })),
    };
  }
}
