import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectTransportSchema } from './transport-schema.util';
import { buildDynamicInsert, buildDynamicSet, type DynamicField } from './transport-sql.util';
import type { CreateBusDto } from './dto/create-bus.dto';
import type { UpdateBusDto } from './dto/update-bus.dto';

/**
 * With the pg driver adapter (Prisma 7), a raw unique-violation from
 * Postgres (code 23505) doesn't surface as a bare `err.code === '23505'` —
 * $queryRaw wraps it as a PrismaClientKnownRequestError with its own code
 * ('P2010') and buries the real Postgres error under
 * `err.meta.driverAdapterError.cause`. Check both shapes so this works
 * whether the error came through the adapter or (in a future Prisma
 * version) more directly.
 */
function isUniqueViolation(err: unknown): string | null {
  const e = err as {
    code?: string;
    detail?: string;
    meta?: { driverAdapterError?: { cause?: { originalCode?: string; kind?: string; constraint?: { fields?: string[] } } } };
  } | null;
  if (e?.code === '23505') {
    return e.detail ?? 'A bus with one of these values already exists.';
  }
  const cause = e?.meta?.driverAdapterError?.cause;
  if (cause?.originalCode === '23505' || cause?.kind === 'UniqueConstraintViolation') {
    const field = cause.constraint?.fields?.[0];
    return field ? `A bus with this ${field.replace(/_/g, ' ')} already exists.` : 'A bus with one of these values already exists.';
  }
  return null;
}

/**
 * Create/update for the "Add vehicle" modal and the bus detail page's "Edit
 * record". Written entirely as raw SQL (not the typed Prisma client) because
 * most of the columns here — capacity/status/licence/vehicle-spec-sheet —
 * only exist once the migrations handed alongside earlier transport-module
 * work are applied; each field is only included in the INSERT/UPDATE when
 * both a value was given AND its column is confirmed present, so this never
 * 500s on a column that doesn't exist yet, it just silently can't write it.
 */
@Injectable()
export class TransportBusWriteService {
  private readonly logger = new Logger(TransportBusWriteService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBusDto) {
    const schema = await detectTransportSchema(this.prisma);

    const fields: DynamicField[] = [
      { column: 'bus_no', value: dto.bus_no },
      { column: 'vehicle_number', value: dto.vehicle_number },
      { column: 'route_id', value: dto.route_id },
      { column: 'driver_name', value: dto.driver_name },
      { column: 'gps_device_id', value: dto.gps_device_id },
      { column: 'capacity', value: dto.capacity, allowed: schema.fleetExtras },
      { column: 'driver_phone', value: dto.driver_phone, allowed: schema.fleetExtras },
      { column: 'driver_licence_no', value: dto.driver_licence_no, allowed: schema.fleetExtras },
      { column: 'driver_licence_expiry', value: dto.driver_licence_expiry, allowed: schema.fleetExtras },
      { column: 'attendant_name', value: dto.attendant_name, allowed: schema.fleetExtras },
      { column: 'attendant_phone', value: dto.attendant_phone, allowed: schema.fleetExtras },
      { column: 'model', value: dto.model, allowed: schema.extendedSpecs },
      { column: 'year_of_manufacture', value: dto.year_of_manufacture, allowed: schema.vehicleSpecs },
      { column: 'chassis_no', value: dto.chassis_no, allowed: schema.vehicleSpecs },
      { column: 'engine_no', value: dto.engine_no, allowed: schema.vehicleSpecs },
      { column: 'fuel_emission', value: dto.fuel_emission, allowed: schema.vehicleSpecs },
      { column: 'parking_bay', value: dto.parking_bay, allowed: schema.vehicleSpecs },
    ];
    const { columns, values } = buildDynamicInsert(fields);

    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO buses (${columns}) VALUES (${values}) RETURNING id
      `);
      const busId = rows[0].id;

      if (schema.documents) {
        const docDates: { doc_type: string; valid_until?: string }[] = [
          { doc_type: 'insurance', valid_until: dto.insurance_valid_till },
          { doc_type: 'fitness_certificate', valid_until: dto.fc_valid_till },
          { doc_type: 'permit', valid_until: dto.permit_valid_till },
        ];
        for (const doc of docDates) {
          if (!doc.valid_until) continue;
          await this.prisma.$executeRaw(Prisma.sql`
            INSERT INTO bus_documents (bus_id, doc_type, valid_until)
            VALUES (${busId}, ${doc.doc_type}, ${doc.valid_until}::date)
            ON CONFLICT (bus_id, doc_type) DO UPDATE SET valid_until = EXCLUDED.valid_until, updated_at = now()
          `);
        }
      }

      this.logger.log(`Bus created: id=${busId} bus_no=${dto.bus_no}`);
      return { id: busId, bus_no: dto.bus_no, vehicle_number: dto.vehicle_number };
    } catch (err) {
      const detail = isUniqueViolation(err);
      if (detail) {
        throw new ConflictException({ message: detail, errorCode: 'BUS_ALREADY_EXISTS' });
      }
      this.logger.error('DB error creating bus', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async update(id: number, dto: UpdateBusDto) {
    const schema = await detectTransportSchema(this.prisma);

    const fields: DynamicField[] = [
      { column: 'bus_no', value: dto.bus_no },
      { column: 'vehicle_number', value: dto.vehicle_number },
      { column: 'route_id', value: dto.route_id },
      { column: 'driver_name', value: dto.driver_name },
      { column: 'gps_device_id', value: dto.gps_device_id },
      { column: 'status', value: dto.status, allowed: schema.fleetExtras },
      { column: 'capacity', value: dto.capacity, allowed: schema.fleetExtras },
      { column: 'driver_phone', value: dto.driver_phone, allowed: schema.fleetExtras },
      { column: 'driver_licence_no', value: dto.driver_licence_no, allowed: schema.fleetExtras },
      { column: 'driver_licence_expiry', value: dto.driver_licence_expiry, allowed: schema.fleetExtras },
      { column: 'attendant_name', value: dto.attendant_name, allowed: schema.fleetExtras },
      { column: 'attendant_phone', value: dto.attendant_phone, allowed: schema.fleetExtras },
      { column: 'odometer_km', value: dto.odometer_km, allowed: schema.fleetExtras },
      { column: 'next_service_due_km', value: dto.next_service_due_km, allowed: schema.fleetExtras },
      { column: 'last_service_date', value: dto.last_service_date, allowed: schema.fleetExtras },
      { column: 'model', value: dto.model, allowed: schema.extendedSpecs },
      { column: 'body_type', value: dto.body_type, allowed: schema.vehicleSpecs },
      { column: 'year_of_manufacture', value: dto.year_of_manufacture, allowed: schema.vehicleSpecs },
      { column: 'fuel_emission', value: dto.fuel_emission, allowed: schema.vehicleSpecs },
      { column: 'chassis_no', value: dto.chassis_no, allowed: schema.vehicleSpecs },
      { column: 'engine_no', value: dto.engine_no, allowed: schema.vehicleSpecs },
      { column: 'engine_spec', value: dto.engine_spec, allowed: schema.vehicleSpecs },
      { column: 'wheelbase_mm', value: dto.wheelbase_mm, allowed: schema.vehicleSpecs },
      { column: 'tyre_spec', value: dto.tyre_spec, allowed: schema.vehicleSpecs },
      { column: 'fuel_tank_litres', value: dto.fuel_tank_litres, allowed: schema.vehicleSpecs },
      { column: 'ownership', value: dto.ownership, allowed: schema.vehicleSpecs },
      { column: 'rto', value: dto.rto, allowed: schema.vehicleSpecs },
      { column: 'parking_bay', value: dto.parking_bay, allowed: schema.vehicleSpecs },
      { column: 'registered_date', value: dto.registered_date, allowed: schema.vehicleSpecs },
      { column: 'driver_experience_years', value: dto.driver_experience_years, allowed: schema.vehicleSpecs },
      { column: 'driver_blood_group', value: dto.driver_blood_group, allowed: schema.vehicleSpecs },
    ];
    const setClause = buildDynamicSet(fields);
    if (!setClause) {
      throw new BadRequestException({ message: 'No fields provided to update', errorCode: 'VALIDATION_ERROR' });
    }

    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE buses SET ${setClause} WHERE id = ${id} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({ message: 'Bus not found', errorCode: 'BUS_NOT_FOUND' });
      }
      this.logger.log(`Bus updated: id=${id}`);
      return { id };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      const detail = isUniqueViolation(err);
      if (detail) {
        throw new ConflictException({ message: detail, errorCode: 'BUS_ALREADY_EXISTS' });
      }
      this.logger.error('DB error updating bus', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
