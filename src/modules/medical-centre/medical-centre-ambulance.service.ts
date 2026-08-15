import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { CreateTripDto } from './dto/create-trip.dto';

interface StatusRow {
  id: number;
  vehicle_number: string;
  oxygen_cylinder_status: string;
  status: string;
  driver_name: string | null;
  driver_phone: string | null;
}

interface TripRow {
  id: number;
  case_summary: string;
  detail: string | null;
  outcome: string;
  occurred_at: Date;
}

/** Ambulance — ambulance_status (single row) + ambulance_trips. Emergency contacts are derived from real medical_staff rather than a separate table. */
@Injectable()
export class MedicalCentreAmbulanceService {
  private readonly logger = new Logger(MedicalCentreAmbulanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getAmbulance() {
    try {
      const statusRows = await this.prisma.$queryRaw<StatusRow[]>(Prisma.sql`
        SELECT a.id, a.vehicle_number, a.oxygen_cylinder_status, a.status, ms.name AS driver_name, ms.phone AS driver_phone
        FROM ambulance_status a
        LEFT JOIN medical_staff ms ON ms.id = a.driver_staff_id
        ORDER BY a.id ASC LIMIT 1
      `);
      const status = statusRows[0];

      const staffContacts = await this.prisma.medical_staff.findMany({
        select: { name: true, designation: true, phone: true },
        orderBy: { name: 'asc' },
      });

      const tripsThisMonth = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT count(*) AS count FROM ambulance_trips WHERE occurred_at >= date_trunc('month', now())
      `);

      const trips = await this.prisma.$queryRaw<TripRow[]>(Prisma.sql`
        SELECT id, case_summary, detail, outcome, occurred_at FROM ambulance_trips ORDER BY occurred_at DESC LIMIT 10
      `);

      return {
        vehicle: status
          ? {
              vehicleNumber: status.vehicle_number,
              driverName: status.driver_name ?? 'Not assigned',
              driverPhone: status.driver_phone ?? '—',
              oxygenStatus: status.oxygen_cylinder_status,
              status: status.status === 'dispatched' ? 'Dispatched' : 'On call',
              tripsThisMonth: Number(tripsThisMonth[0]?.count ?? 0),
            }
          : null,
        contacts: staffContacts.map((s) => ({ name: s.name, role: s.designation ?? '—', phone: s.phone ?? '—' })),
        trips: trips.map((t) => ({
          when: t.occurred_at.toISOString(),
          caseText: t.case_summary,
          detail: t.detail ?? '—',
          outcome: t.outcome === 'referred' ? 'Referred' : 'Returned',
        })),
      };
    } catch (err) {
      this.logger.error('DB error building ambulance view', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async setStatus(status: 'on_call' | 'dispatched') {
    try {
      await this.prisma.$executeRaw(Prisma.sql`UPDATE ambulance_status SET status = ${status}, updated_at = now() WHERE id = (SELECT id FROM ambulance_status ORDER BY id ASC LIMIT 1)`);
      return { status: status === 'dispatched' ? 'Dispatched' : 'On call' };
    } catch (err) {
      this.logger.error('DB error updating ambulance status', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async logTrip(dto: CreateTripDto) {
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO ambulance_trips (case_summary, detail, outcome) VALUES (${dto.case_summary}, ${dto.detail ?? null}, ${dto.outcome})
      `);
      return { ok: true };
    } catch (err) {
      this.logger.error('DB error logging ambulance trip', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
