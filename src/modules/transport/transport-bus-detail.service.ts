import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { BUS_DOC_TYPES } from './dto/upsert-bus-document.dto';
import { DOC_TYPE_LABEL, daysBetween, detectTransportSchema, type TransportSchemaFlags } from './transport-schema.util';

interface BusRow {
  id: number;
  bus_no: string;
  vehicle_number: string;
  driver_name: string | null;
  gps_device_id: string | null;
  route_id: number | null;
  route_name: string | null;
  route_distance_km: string | null;
  route_boarding_area: string | null;
  route_departure_time: string | null;
  route_arrival_time: string | null;
  last_seen: Date | null;
  status: string | null;
  capacity: number | null;
  model: string | null;
  driver_phone: string | null;
  driver_licence_no: string | null;
  driver_licence_expiry: Date | null;
  driver_experience_years: number | null;
  driver_blood_group: string | null;
  attendant_name: string | null;
  attendant_phone: string | null;
  odometer_km: number | null;
  next_service_due_km: number | null;
  last_service_date: Date | null;
  body_type: string | null;
  year_of_manufacture: number | null;
  fuel_emission: string | null;
  chassis_no: string | null;
  engine_no: string | null;
  engine_spec: string | null;
  wheelbase_mm: number | null;
  tyre_spec: string | null;
  fuel_tank_litres: number | null;
  ownership: string | null;
  rto: string | null;
  parking_bay: string | null;
  registered_date: Date | null;
}
interface StageRow {
  id: number;
  sequence_no: number;
  stage_name: string;
  pickup_time: string | null;
}
interface BoardCountRow {
  boarding_stage_id: number;
  cnt: bigint;
}
interface StudentFeeRow {
  fee_amount: string;
  cnt: bigint;
}
interface BusFee {
  per_student: number | null;
  range: { min: number; max: number } | null;
  total_due: number;
}
interface DocRow {
  doc_type: string;
  reference_no: string | null;
  valid_until: Date;
}
interface ServiceLogRow {
  id: number;
  service_date: Date;
  work_description: string;
  garage: string | null;
  odometer_km: number | null;
  cost: string | null;
}
interface FuelLogRow {
  id: number;
  fill_date: Date;
  litres: string;
  rate_per_litre: string | null;
  station: string | null;
  odometer_km: number | null;
  cost: string | null;
}
interface SafetyCheckRow {
  item_key: string;
  status_text: string;
  is_ok: boolean;
  checked_date: Date | null;
}

const SAFETY_ITEM_LABEL: Record<string, string> = {
  first_aid_box: 'First-aid box',
  fire_extinguisher: 'Fire extinguisher',
  emergency_exit: 'Emergency exit door',
  speed_governor: 'Speed governor',
  cctv: 'CCTV',
  reverse_alarm: 'Reverse alarm & horn',
  tyre_condition: 'Tyre condition',
};

/**
 * Bus detail drill-down — the vehicle spec sheet, per-stop pickup times,
 * fuel log, and safety checklist have no home anywhere else in the schema,
 * so this endpoint alone needs 4 more extended-schema flags on top of what
 * the list/compliance/maintenance screens already use (see
 * transport-schema.util). Every section renders "not tracked yet" rather
 * than a fabricated value until its SQL is applied.
 */
@Injectable()
export class TransportBusDetailService {
  private readonly logger = new Logger(TransportBusDetailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getDetail(busId: number) {
    try {
      const schema = await detectTransportSchema(this.prisma);

      const fleetSelect = schema.fleetExtras
        ? Prisma.sql`, b.status, b.capacity, b.driver_phone, b.driver_licence_no, b.driver_licence_expiry, b.attendant_name, b.attendant_phone, b.odometer_km, b.next_service_due_km, b.last_service_date`
        : Prisma.empty;
      const specSelect = schema.extendedSpecs
        ? Prisma.sql`, b.model, tr.distance_km::text AS route_distance_km, tr.boarding_area AS route_boarding_area, tr.departure_time::text AS route_departure_time, tr.arrival_time::text AS route_arrival_time`
        : Prisma.empty;
      const vehicleSelect = schema.vehicleSpecs
        ? Prisma.sql`, b.body_type, b.year_of_manufacture, b.fuel_emission, b.chassis_no, b.engine_no, b.engine_spec, b.wheelbase_mm, b.tyre_spec, b.fuel_tank_litres, b.ownership, b.rto, b.parking_bay, b.registered_date, b.driver_experience_years, b.driver_blood_group`
        : Prisma.empty;

      const rows = await this.prisma.$queryRaw<BusRow[]>(Prisma.sql`
        SELECT b.id, b.bus_no, b.vehicle_number, b.driver_name, b.gps_device_id, b.route_id, tr.name AS route_name,
          ll.last_seen
          ${fleetSelect}
          ${specSelect}
          ${vehicleSelect}
        FROM buses b
        LEFT JOIN transport_routes tr ON tr.id = b.route_id
        LEFT JOIN LATERAL (
          SELECT MAX(updated_at) AS last_seen FROM bus_live_locations WHERE bus_id = b.id
        ) ll ON true
        WHERE b.id = ${busId}
      `);
      const bus = rows[0];
      if (!bus) {
        throw new NotFoundException({ message: 'Bus not found', errorCode: 'BUS_NOT_FOUND' });
      }

      // Sequential, not Promise.all — the pooled connection is small and shared.
      const ridershipCount = await this.getRidershipCount(bus, schema);
      const stops = await this.getStops(bus.route_id, schema);
      const termFee = await this.getTermFee(bus, schema);
      const documents = await this.getDocuments(bus.id, schema);
      const maintenance = await this.getMaintenance(bus.id, schema);
      const fuel = await this.getFuel(bus.id, schema);
      const safety = await this.getSafety(bus.id, schema);

      const now = new Date();
      const capacity = schema.fleetExtras ? bus.capacity ?? null : null;
      const licenceExpiry = schema.fleetExtras ? bus.driver_licence_expiry ?? null : null;

      return {
        extended: {
          fleet_status: schema.fleetExtras,
          specs: schema.extendedSpecs,
          vehicle_specs: schema.vehicleSpecs,
          stage_times: schema.stageTimes,
          documents: schema.documents,
          service_log: schema.serviceLog,
          fuel_log: schema.fuelLog,
          safety_checks: schema.safetyChecks,
        },
        bus: {
          id: bus.id,
          bus_no: bus.bus_no,
          vehicle_number: bus.vehicle_number,
          status: schema.fleetExtras ? bus.status ?? null : null,
          model: schema.extendedSpecs ? bus.model ?? null : null,
          gps_device_id: bus.gps_device_id,
          gps: {
            online: bus.last_seen ? now.getTime() - bus.last_seen.getTime() < 10 * 60_000 : false,
            last_seen: bus.last_seen,
          },
          registered_date: schema.vehicleSpecs ? bus.registered_date ?? null : null,
        },
        route: bus.route_id
          ? {
              id: bus.route_id,
              name: bus.route_name,
              distance_km: schema.extendedSpecs && bus.route_distance_km != null ? Number(bus.route_distance_km) : null,
              boarding_area: schema.extendedSpecs ? bus.route_boarding_area ?? null : null,
              departure_time: schema.extendedSpecs ? bus.route_departure_time ?? null : null,
              arrival_time: schema.extendedSpecs ? bus.route_arrival_time ?? null : null,
              stops_count: stops.length,
              stops,
              term_fee: termFee,
            }
          : null,
        occupancy: {
          count: ridershipCount,
          capacity,
          seats_free: capacity != null ? capacity - ridershipCount : null,
          percent: capacity ? Math.round((ridershipCount / capacity) * 100) : null,
        },
        odometer: {
          odometer_km: schema.fleetExtras ? bus.odometer_km ?? null : null,
          next_service_due_km: schema.fleetExtras ? bus.next_service_due_km ?? null : null,
          last_service_date: schema.fleetExtras ? bus.last_service_date ?? null : null,
        },
        crew: {
          driver_name: bus.driver_name,
          driver_phone: schema.fleetExtras ? bus.driver_phone ?? null : null,
          driver_licence_no: schema.fleetExtras ? bus.driver_licence_no ?? null : null,
          driver_licence_expiry: licenceExpiry,
          licence_state: licenceExpiry ? (daysBetween(now, licenceExpiry) < 0 ? 'expired' : daysBetween(now, licenceExpiry) < 45 ? 'due_soon' : 'valid') : null,
          driver_experience_years: schema.vehicleSpecs ? bus.driver_experience_years ?? null : null,
          driver_blood_group: schema.vehicleSpecs ? bus.driver_blood_group ?? null : null,
          attendant_name: schema.fleetExtras ? bus.attendant_name ?? null : null,
          attendant_phone: schema.fleetExtras ? bus.attendant_phone ?? null : null,
        },
        spec: schema.vehicleSpecs
          ? {
              body_type: bus.body_type,
              year_of_manufacture: bus.year_of_manufacture,
              fuel_emission: bus.fuel_emission,
              chassis_no: bus.chassis_no,
              engine_no: bus.engine_no,
              engine_spec: bus.engine_spec,
              wheelbase_mm: bus.wheelbase_mm,
              tyre_spec: bus.tyre_spec,
              fuel_tank_litres: bus.fuel_tank_litres,
              ownership: bus.ownership,
              rto: bus.rto,
              parking_bay: bus.parking_bay,
            }
          : null,
        documents,
        maintenance,
        fuel,
        safety,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error loading bus detail', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async getRidershipCount(bus: BusRow, schema: TransportSchemaFlags): Promise<number> {
    if (schema.perBusRidership) {
      const rows = await this.prisma.$queryRaw<{ cnt: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt FROM student_transport_mapping WHERE bus_id = ${bus.id}
      `);
      return Number(rows[0]?.cnt ?? 0);
    }
    if (!bus.route_id) return 0;
    const rows = await this.prisma.$queryRaw<{ cnt: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS cnt FROM student_transport_mapping WHERE route_id = ${bus.route_id}
    `);
    return Number(rows[0]?.cnt ?? 0);
  }

  private async getStops(routeId: number | null, schema: TransportSchemaFlags) {
    if (!routeId) return [];
    const timeSelect = schema.stageTimes ? Prisma.sql`, pickup_time::text AS pickup_time` : Prisma.sql`, NULL AS pickup_time`;
    const stages = await this.prisma.$queryRaw<StageRow[]>(Prisma.sql`
      SELECT id, sequence_no, stage_name ${timeSelect} FROM transport_stages WHERE route_id = ${routeId} ORDER BY sequence_no ASC
    `);
    const boardRows = await this.prisma.$queryRaw<BoardCountRow[]>(Prisma.sql`
      SELECT stm.boarding_stage_id, COUNT(*)::bigint AS cnt
      FROM student_transport_mapping stm
      JOIN transport_stages ts ON ts.id = stm.boarding_stage_id
      WHERE ts.route_id = ${routeId}
      GROUP BY stm.boarding_stage_id
    `);
    const boardByStageId = new Map(boardRows.map((r) => [r.boarding_stage_id, Number(r.cnt)]));

    return stages.map((s) => ({
      sequence_no: s.sequence_no,
      stage_name: s.stage_name,
      pickup_time: s.pickup_time,
      board_count: boardByStageId.get(s.id) ?? 0,
    }));
  }

  /**
   * What this bus's own riders actually pay — student_transport_mapping's
   * own boarding_stage_id -> transport_stages.fee_amount, scoped to this
   * specific bus when per-bus ridership is tracked, else to the whole
   * route (same fallback the occupancy count uses). Not "the most
   * expensive stage on the route" — that overstates real fees whenever a
   * route has stages at different fares than the one riders are actually
   * assigned to.
   */
  private async getTermFee(bus: BusRow, schema: TransportSchemaFlags): Promise<BusFee> {
    const empty: BusFee = { per_student: null, range: null, total_due: 0 };
    if (!bus.route_id) return empty;

    const scopeCondition = schema.perBusRidership ? Prisma.sql`stm.bus_id = ${bus.id}` : Prisma.sql`stm.route_id = ${bus.route_id}`;
    const rows = await this.prisma.$queryRaw<StudentFeeRow[]>(Prisma.sql`
      SELECT ts.fee_amount::text AS fee_amount, COUNT(*)::bigint AS cnt
      FROM student_transport_mapping stm
      JOIN transport_stages ts ON ts.id = stm.boarding_stage_id
      WHERE ${scopeCondition}
      GROUP BY ts.fee_amount
    `);
    if (rows.length === 0) return empty;

    const amounts = rows.map((r) => Number(r.fee_amount));
    const totalDue = rows.reduce((sum, r) => sum + Number(r.fee_amount) * Number(r.cnt), 0);
    return rows.length === 1
      ? { per_student: amounts[0], range: null, total_due: totalDue }
      : { per_student: null, range: { min: Math.min(...amounts), max: Math.max(...amounts) }, total_due: totalDue };
  }

  private async getDocuments(busId: number, schema: TransportSchemaFlags) {
    if (!schema.documents) return [];
    const rows = await this.prisma.$queryRaw<DocRow[]>(Prisma.sql`
      SELECT doc_type, reference_no, valid_until FROM bus_documents WHERE bus_id = ${busId}
    `);
    const byType = new Map(rows.map((r) => [r.doc_type, r]));
    const now = new Date();
    return BUS_DOC_TYPES.map((docType) => {
      const row = byType.get(docType);
      const state = !row ? 'missing' : daysBetween(now, row.valid_until) < 0 ? 'expired' : daysBetween(now, row.valid_until) < 45 ? 'due_soon' : 'valid';
      return {
        doc_type: docType,
        label: DOC_TYPE_LABEL[docType] ?? docType,
        reference_no: row?.reference_no ?? null,
        valid_until: row?.valid_until ?? null,
        state,
      };
    });
  }

  private async getMaintenance(busId: number, schema: TransportSchemaFlags) {
    if (!schema.serviceLog) return [];
    const rows = await this.prisma.$queryRaw<ServiceLogRow[]>(Prisma.sql`
      SELECT id, service_date, work_description, garage, odometer_km, cost::text AS cost
      FROM bus_service_logs WHERE bus_id = ${busId} ORDER BY service_date DESC, id DESC
    `);
    return rows.map((r) => ({
      id: r.id,
      service_date: r.service_date,
      work_description: r.work_description,
      garage: r.garage,
      odometer_km: r.odometer_km,
      cost: r.cost != null ? Number(r.cost) : null,
    }));
  }

  private async getFuel(busId: number, schema: TransportSchemaFlags) {
    if (!schema.fuelLog) return { entries: [] as unknown[], avg_mileage_km_per_litre: null as number | null };
    const rows = await this.prisma.$queryRaw<FuelLogRow[]>(Prisma.sql`
      SELECT id, fill_date, litres::text AS litres, rate_per_litre::text AS rate_per_litre, station, odometer_km, cost::text AS cost
      FROM bus_fuel_logs WHERE bus_id = ${busId} ORDER BY fill_date DESC, id DESC
    `);

    // Mileage needs consecutive fills in chronological (ascending) order.
    const chronological = [...rows].reverse();
    const mileages: number[] = [];
    for (let i = 1; i < chronological.length; i++) {
      const prev = chronological[i - 1];
      const cur = chronological[i];
      if (prev.odometer_km != null && cur.odometer_km != null && cur.odometer_km > prev.odometer_km) {
        const litres = Number(cur.litres);
        if (litres > 0) mileages.push((cur.odometer_km - prev.odometer_km) / litres);
      }
    }
    const avgMileage = mileages.length > 0 ? mileages.reduce((a, b) => a + b, 0) / mileages.length : null;

    return {
      entries: rows.map((r) => ({
        id: r.id,
        fill_date: r.fill_date,
        litres: Number(r.litres),
        rate_per_litre: r.rate_per_litre != null ? Number(r.rate_per_litre) : null,
        station: r.station,
        odometer_km: r.odometer_km,
        cost: r.cost != null ? Number(r.cost) : null,
      })),
      avg_mileage_km_per_litre: avgMileage != null ? Math.round(avgMileage * 10) / 10 : null,
    };
  }

  private async getSafety(busId: number, schema: TransportSchemaFlags) {
    if (!schema.safetyChecks) return [];
    const rows = await this.prisma.$queryRaw<SafetyCheckRow[]>(Prisma.sql`
      SELECT item_key, status_text, is_ok, checked_date FROM bus_safety_checks WHERE bus_id = ${busId}
    `);
    return rows.map((r) => ({
      item_key: r.item_key,
      label: SAFETY_ITEM_LABEL[r.item_key] ?? r.item_key,
      status_text: r.status_text,
      is_ok: r.is_ok,
      checked_date: r.checked_date,
    }));
  }
}
