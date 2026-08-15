import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface StaffRow {
  id: number;
  name: string;
  designation: string | null;
  shift_time: string | null;
  phone: string | null;
  on_duty: boolean;
  qualification: string | null;
  specialization: string | null;
  experience_years: number | null;
  previous_institution: string | null;
  previous_role: string | null;
  previous_duration: string | null;
  registration_no: string | null;
  email: string | null;
  joined_date: Date | null;
  working_days: string | null;
  emergency_duty_available: boolean;
  status: string;
}

function dash(value: string | null): string {
  return value == null || value.trim() === '' ? '—' : value;
}

/** Medical team / Staff profile — medical_staff, a real Prisma model extended with profile columns. */
@Injectable()
export class MedicalCentreTeamService {
  private readonly logger = new Logger(MedicalCentreTeamService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async fetchAll(): Promise<StaffRow[]> {
    return this.prisma.$queryRaw<StaffRow[]>(Prisma.sql`
      SELECT id, name, designation, shift_time, phone, on_duty, qualification, specialization, experience_years,
        previous_institution, previous_role, previous_duration, registration_no, email, joined_date, working_days,
        emergency_duty_available, status
      FROM medical_staff ORDER BY name ASC
    `);
  }

  private toDto(r: StaffRow) {
    return {
      sid: `MED-${String(r.id).padStart(2, '0')}`,
      id: r.id,
      name: r.name,
      desig: dash(r.designation),
      qual: dash(r.qualification),
      spec: dash(r.specialization),
      exp: r.experience_years != null ? `${r.experience_years} years` : '—',
      prevInst: dash(r.previous_institution),
      prevRole: dash(r.previous_role),
      prevDur: dash(r.previous_duration),
      reg: dash(r.registration_no),
      email: dash(r.email),
      joined: r.joined_date ? r.joined_date.toISOString().slice(0, 10) : '—',
      days: dash(r.working_days),
      timing: dash(r.shift_time),
      emergency: r.emergency_duty_available ? 'Available on call' : 'Not on emergency roster',
      status: r.status === 'on_leave' ? 'On Leave' : 'Active',
      phone: dash(r.phone),
      duty: r.on_duty,
    };
  }

  async findAll() {
    try {
      return (await this.fetchAll()).map((r) => this.toDto(r));
    } catch (err) {
      this.logger.error('DB error listing medical staff', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async findOne(id: number) {
    try {
      const rows = await this.fetchAll();
      const row = rows.find((r) => r.id === id);
      if (!row) throw new NotFoundException({ message: 'Staff member not found', errorCode: 'STAFF_NOT_FOUND' });
      return this.toDto(row);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error fetching medical staff ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async setDuty(id: number, onDuty: boolean) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`UPDATE medical_staff SET on_duty = ${onDuty} WHERE id = ${id} RETURNING id`);
      if (rows.length === 0) throw new NotFoundException({ message: 'Staff member not found', errorCode: 'STAFF_NOT_FOUND' });
      return { id, duty: onDuty };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error setting duty for staff ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async setStatus(id: number, status: 'active' | 'on_leave') {
    try {
      const clearDuty = status === 'on_leave';
      const rows = clearDuty
        ? await this.prisma.$queryRaw<{ id: number; on_duty: boolean }[]>(Prisma.sql`
            UPDATE medical_staff SET status = ${status}, on_duty = false WHERE id = ${id} RETURNING id, on_duty
          `)
        : await this.prisma.$queryRaw<{ id: number; on_duty: boolean }[]>(Prisma.sql`
            UPDATE medical_staff SET status = ${status} WHERE id = ${id} RETURNING id, on_duty
          `);
      const row = rows[0];
      if (!row) throw new NotFoundException({ message: 'Staff member not found', errorCode: 'STAFF_NOT_FOUND' });
      return { id, status: status === 'on_leave' ? 'On Leave' : 'Active', duty: row.on_duty };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error setting status for staff ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
