import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DrivesService } from '../drives/drives.service';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { RescheduleInterviewDto } from './dto/reschedule-interview.dto';
import { RecordInterviewResultDto } from './dto/record-interview-result.dto';

interface InterviewBaseRow {
  id: number;
  student_id: number;
  drive_id: number;
  interview_date: Date;
  round_label: string;
  slot_label: string;
  panel_member: string;
  status: string;
  panel_feedback: string | null;
  created_at: Date;
}

const NOT_ENABLED_MESSAGE =
  "Interview scheduling isn't enabled yet — ask an admin to run query.md #15.";

/**
 * `placement_interviews` is real once query.md #15 runs — every call here
 * is via `$queryRaw` (there's no `student_drive_applications` duplicate:
 * the linked application's own `status` is the single source of truth for
 * "Result", read/written through `DrivesService`). Reads degrade to `[]`
 * when the table doesn't exist yet; writes throw a clear 503 instead of
 * silently pretending to succeed, since there's no base row to fall back to
 * for a feature this new.
 */
@Injectable()
export class InterviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drivesService: DrivesService,
  ) {}

  async list() {
    let base: InterviewBaseRow[];
    try {
      base = await this.prisma.$queryRaw<InterviewBaseRow[]>`
        SELECT id, student_id, drive_id, interview_date, round_label, slot_label, panel_member, status, panel_feedback, created_at
        FROM placement_interviews ORDER BY created_at DESC
      `;
    } catch {
      return [];
    }
    if (base.length === 0) return [];

    return this.hydrate(base);
  }

  async findOne(id: number) {
    const row = await this.findRowOrThrow(id);
    const [hydrated] = await this.hydrate([row]);
    return hydrated;
  }

  async create(user: JwtPayload, dto: CreateInterviewDto) {
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student) {
      throw new NotFoundException(`Student ${dto.student_id} not found`);
    }
    const drive = await this.prisma.placement_drives.findUnique({
      where: { id: dto.drive_id },
    });
    if (!drive) {
      throw new NotFoundException(`Drive ${dto.drive_id} not found`);
    }

    const existingApplication =
      await this.prisma.student_drive_applications.findUnique({
        where: {
          drive_id_student_id: {
            drive_id: dto.drive_id,
            student_id: dto.student_id,
          },
        },
      });
    if (!existingApplication) {
      await this.prisma.student_drive_applications.create({
        data: { drive_id: dto.drive_id, student_id: dto.student_id },
      });
    }

    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>`
        INSERT INTO placement_interviews (student_id, drive_id, interview_date, round_label, slot_label, panel_member, status, created_by_user_id)
        VALUES (${dto.student_id}, ${dto.drive_id}, ${dto.interview_date}::date, ${dto.round_label}, ${dto.slot_label}, ${dto.panel_member}, 'scheduled', ${user.sub})
        RETURNING id
      `;
      return this.findOne(rows[0].id);
    } catch {
      throw new ServiceUnavailableException(NOT_ENABLED_MESSAGE);
    }
  }

  async reschedule(id: number, dto: RescheduleInterviewDto) {
    await this.findRowOrThrow(id);

    try {
      await this.prisma.$executeRaw`
        UPDATE placement_interviews SET
          interview_date = COALESCE(${dto.interview_date ?? null}::date, interview_date),
          round_label = COALESCE(${dto.round_label ?? null}, round_label),
          slot_label = COALESCE(${dto.slot_label ?? null}, slot_label),
          panel_member = COALESCE(${dto.panel_member ?? null}, panel_member),
          status = 'scheduled',
          updated_at = now()
        WHERE id = ${id}
      `;
      return this.findOne(id);
    } catch {
      throw new ServiceUnavailableException(NOT_ENABLED_MESSAGE);
    }
  }

  async recordResult(
    user: JwtPayload,
    id: number,
    dto: RecordInterviewResultDto,
  ) {
    const row = await this.findRowOrThrow(id);

    await this.drivesService.updateApplicationStatus(
      user,
      row.drive_id,
      row.student_id,
      { status: dto.result },
    );

    try {
      await this.prisma.$executeRaw`
        UPDATE placement_interviews SET
          status = 'completed',
          panel_feedback = COALESCE(${dto.panel_feedback ?? null}, panel_feedback),
          updated_at = now()
        WHERE id = ${id}
      `;
    } catch {
      throw new ServiceUnavailableException(NOT_ENABLED_MESSAGE);
    }

    return this.findOne(id);
  }

  private async findRowOrThrow(id: number): Promise<InterviewBaseRow> {
    try {
      const rows = await this.prisma.$queryRaw<InterviewBaseRow[]>`
        SELECT id, student_id, drive_id, interview_date, round_label, slot_label, panel_member, status, panel_feedback, created_at
        FROM placement_interviews WHERE id = ${id}
      `;
      if (!rows[0]) throw new NotFoundException(`Interview ${id} not found`);
      return rows[0];
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw new ServiceUnavailableException(NOT_ENABLED_MESSAGE);
    }
  }

  private async hydrate(base: InterviewBaseRow[]) {
    const studentIds = [...new Set(base.map((b) => b.student_id))];
    const driveIds = [...new Set(base.map((b) => b.drive_id))];

    const [students, drives, applications] = await Promise.all([
      this.prisma.students.findMany({
        where: { id: { in: studentIds } },
        select: {
          id: true,
          student_id_no: true,
          roll_no: true,
          register_no: true,
          classes: {
            select: { departments: { select: { name: true, code: true } } },
          },
          soa_applications: { select: { first_name: true, last_name: true } },
          users: { select: { email: true } },
        },
      }),
      this.prisma.placement_drives.findMany({
        where: { id: { in: driveIds } },
        select: {
          id: true,
          job_role: true,
          companies: { select: { name: true } },
        },
      }),
      this.prisma.student_drive_applications.findMany({
        where: { student_id: { in: studentIds }, drive_id: { in: driveIds } },
        select: { student_id: true, drive_id: true, status: true },
      }),
    ]);

    const studentMap = new Map(students.map((s) => [s.id, s]));
    const driveMap = new Map(drives.map((d) => [d.id, d]));
    const appMap = new Map(
      applications.map((a) => [`${a.student_id}:${a.drive_id}`, a.status]),
    );

    return base.map((b) => {
      const student = studentMap.get(b.student_id);
      const drive = driveMap.get(b.drive_id);
      const soa = student?.soa_applications;
      return {
        id: b.id,
        student_id: b.student_id,
        drive_id: b.drive_id,
        interview_date: b.interview_date,
        student_name:
          soa?.first_name || soa?.last_name
            ? [soa?.first_name, soa?.last_name].filter(Boolean).join(' ')
            : (student?.users.email ?? 'Unknown student'),
        student_id_no: student?.student_id_no ?? String(b.student_id),
        register_no: student?.register_no ?? null,
        department_code: student?.classes?.departments.code ?? null,
        company_name: drive?.companies.name ?? 'Unknown company',
        job_role: drive?.job_role ?? null,
        round_label: b.round_label,
        slot_label: b.slot_label,
        panel_member: b.panel_member,
        status: b.status,
        application_status: appMap.get(`${b.student_id}:${b.drive_id}`) ?? null,
        panel_feedback: b.panel_feedback,
      };
    });
  }
}
