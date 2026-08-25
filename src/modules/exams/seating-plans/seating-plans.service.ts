import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OverviewQueryDto } from './dto/overview-query.dto';
import { VenueDetailQueryDto } from './dto/venue-detail-query.dto';
import { ConfigureVenueDto } from './dto/configure-venue.dto';
import { TargetVenueDto } from './dto/target-venue.dto';
import { AllocateManualDto } from './dto/allocate-manual.dto';
import { ListVersionsQueryDto } from './dto/list-versions-query.dto';

// No "seats per row" field exists anywhere on `venues` — this is a fixed,
// documented default used only to lay out the row/column mixing patterns
// below. Seat numbering itself (row letter + column number) still always
// covers every seat 1..capacity regardless of this value.
const ROW_LENGTH = 10;

const STUDENT_SELECT = {
  id: true,
  register_no: true,
  roll_no: true,
  student_id_no: true,
  class_id: true,
  soa_applications: { select: { first_name: true, last_name: true } },
} as const;

function studentName(soa: { first_name: string; last_name: string | null } | null): string | null {
  if (!soa) return null;
  return [soa.first_name, soa.last_name].filter(Boolean).join(' ').trim() || null;
}

function rowLabelFor(index: number): string {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function seatLabelFor(pos: number): string {
  const row = Math.floor(pos / ROW_LENGTH);
  const col = pos % ROW_LENGTH;
  return `${rowLabelFor(row)}${col + 1}`;
}

/**
 * Same-department queues, one per ticked department (in the order they were
 * ticked). "sequential" drains them in order; the mixed patterns interleave
 * by row/column/checkerboard/snake, falling back to any department with
 * students left so a seat is never left empty just because one department's
 * queue ran dry first.
 */
function buildSeatAssignment(
  capacity: number,
  pattern: string | null,
  deptQueues: number[][],
): { studentId: number; seatLabel: string }[] {
  const queues = deptQueues.map((q) => [...q]);
  const result: { studentId: number; seatLabel: string }[] = [];

  function takeFrom(preferredIdx: number): number | null {
    for (let i = 0; i < queues.length; i++) {
      const idx = (preferredIdx + i) % queues.length;
      if (queues[idx].length > 0) return queues[idx].shift()!;
    }
    return null;
  }

  if (pattern === 'alternate_seat') {
    for (let pos = 0; pos < capacity; pos += 2) {
      const studentId = takeFrom(0);
      if (studentId == null) break;
      result.push({ studentId, seatLabel: seatLabelFor(pos) });
    }
    return result;
  }

  for (let pos = 0; pos < capacity; pos++) {
    const row = Math.floor(pos / ROW_LENGTH);
    const col = pos % ROW_LENGTH;
    let deptIdx = 0;
    if (pattern === 'rowwise_mixed' || pattern === 'snake_order') deptIdx = row % queues.length;
    else if (pattern === 'columnwise_mixed') deptIdx = col % queues.length;
    else if (pattern === 'checkerboard') deptIdx = (row + col) % queues.length;
    // 'sequential' (and null) leaves deptIdx at 0 — queues already ordered department-by-department.
    const studentId = takeFrom(deptIdx);
    if (studentId == null) break;
    result.push({ studentId, seatLabel: seatLabelFor(pos) });
  }
  return result;
}

/** "22IT101-22IT130" -> ["22IT101", ..., "22IT130"]; anything that doesn't share a common prefix is left as two literal entries. */
function expandRegisterRange(entry: string): string[] {
  if (!entry.includes('-')) return [entry];
  const [start, end] = entry.split('-').map((s) => s.trim());
  const startMatch = start.match(/^(.*?)(\d+)$/);
  const endMatch = end.match(/^(.*?)(\d+)$/);
  if (!startMatch || !endMatch || startMatch[1] !== endMatch[1]) return [start, end];
  const prefix = startMatch[1];
  const width = startMatch[2].length;
  const from = parseInt(startMatch[2], 10);
  const to = parseInt(endMatch[2], 10);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from || to - from > 500) return [start, end];
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(prefix + String(n).padStart(width, '0'));
  return out;
}

@Injectable()
export class SeatingPlansService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreateDraftVersion(examId: number, examDate: string, session: string) {
    const date = new Date(examDate);
    const existing = await this.prisma.seating_plan_versions.findFirst({
      where: { exam_id: examId, exam_date: date, session: session as any, status: { in: ['draft', 'ready_to_publish'] } },
      orderBy: { version_number: 'desc' },
    });
    if (existing) return existing;

    const last = await this.prisma.seating_plan_versions.findFirst({
      where: { exam_id: examId, exam_date: date, session: session as any },
      orderBy: { version_number: 'desc' },
    });
    return this.prisma.seating_plan_versions.create({
      data: {
        exam_id: examId,
        exam_date: date,
        session: session as any,
        version_number: (last?.version_number ?? 0) + 1,
        status: 'draft',
      },
    });
  }

  private async getOrCreateVersionVenue(versionId: number, examId: number, examDate: Date, venueId: number) {
    const existing = await this.prisma.seating_plan_version_venues.findUnique({
      where: { version_id_venue_id: { version_id: versionId, venue_id: venueId } },
    });
    if (existing) return existing;

    const hallPlan = await this.prisma.hall_plans.findFirst({
      where: { exam_id: examId, exam_date: examDate, venue_id: venueId },
    });
    if (!hallPlan) {
      throw new NotFoundException({
        message: 'No hall plan exists for this venue on this exam date — add one on Halls & seating first.',
        errorCode: 'HALL_PLAN_NOT_FOUND',
      });
    }

    return this.prisma.seating_plan_version_venues.create({
      data: { version_id: versionId, venue_id: venueId, hall_plan_id: hallPlan.id, allocation_mode: 'automatic' },
    });
  }

  private async eligibleClassesByDepartment(examId: number, examDate: Date, session: string, departmentIds: number[]) {
    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: examId, exam_timetable: { some: { exam_date: examDate, session: session as any } } },
      select: { classes: { select: { id: true, department_id: true } } },
    });
    const classByDept = new Map<number, Set<number>>();
    for (const m of mappings) {
      if (departmentIds.length > 0 && !departmentIds.includes(m.classes.department_id)) continue;
      const set = classByDept.get(m.classes.department_id) ?? new Set<number>();
      set.add(m.classes.id);
      classByDept.set(m.classes.department_id, set);
    }
    return classByDept;
  }

  async getOverview(query: OverviewQueryDto) {
    const examDate = new Date(query.exam_date);
    const version = await this.getOrCreateDraftVersion(query.exam_id, query.exam_date, query.session);

    const [exam, hallPlans] = await Promise.all([
      this.prisma.exams.findUnique({
        where: { id: query.exam_id },
        include: { batches: { select: { name: true } }, exam_types: { select: { name: true } } },
      }),
      this.prisma.hall_plans.findMany({
        where: { exam_id: query.exam_id, exam_date: examDate },
        include: { venues: { select: { id: true, name: true, location: true, capacity: true } } },
        orderBy: { id: 'asc' },
      }),
    ]);
    if (!exam) {
      throw new NotFoundException({ message: 'Exam not found.', errorCode: 'EXAM_NOT_FOUND' });
    }

    const venueIds = hallPlans.map((hp) => hp.venue_id);
    const hallPlanIds = hallPlans.map((hp) => hp.id);

    const [versionVenues, seatCounts] = await Promise.all([
      this.prisma.seating_plan_version_venues.findMany({
        where: { version_id: version.id, venue_id: { in: venueIds } },
        include: { seating_plan_venue_departments: { include: { departments: { select: { id: true, code: true, name: true } } } } },
      }),
      hallPlanIds.length
        ? this.prisma.seating_arrangements.groupBy({
            by: ['hall_plan_id'],
            where: { hall_plan_id: { in: hallPlanIds }, version_id: version.id },
            _count: { _all: true },
          })
        : Promise.resolve([] as { hall_plan_id: number; _count: { _all: number } }[]),
    ]);
    const versionVenueByVenue = new Map(versionVenues.map((vv) => [vv.venue_id, vv]));
    const seatCountByHallPlan = new Map(seatCounts.map((s) => [s.hall_plan_id, s._count._all]));

    const venues = hallPlans.map((hp) => {
      const vv = versionVenueByVenue.get(hp.venue_id);
      const capacity = hp.capacity ?? hp.venues.capacity ?? 0;
      return {
        venue_id: hp.venue_id,
        hall_plan_id: hp.id,
        name: hp.venues.name,
        location: hp.venues.location,
        capacity,
        seated: seatCountByHallPlan.get(hp.id) ?? 0,
        allocation_mode: vv?.allocation_mode ?? null,
        pattern: vv?.pattern ?? null,
        departments: vv?.seating_plan_venue_departments.map((d) => ({ id: d.departments.id, code: d.departments.code, name: d.departments.name })) ?? [],
      };
    });

    return {
      version: { id: version.id, version_number: version.version_number, status: version.status },
      exam: { id: exam.id, academic_year: exam.academic_year, semester: exam.semester, exam_type_name: exam.exam_types.name, batch_name: exam.batches.name },
      total_seats: venues.reduce((sum, v) => sum + v.capacity, 0),
      total_seated: venues.reduce((sum, v) => sum + v.seated, 0),
      venues,
    };
  }

  async getVenueDetail(query: VenueDetailQueryDto) {
    const examDate = new Date(query.exam_date);
    const version = await this.getOrCreateDraftVersion(query.exam_id, query.exam_date, query.session);
    const versionVenue = await this.getOrCreateVersionVenue(version.id, query.exam_id, examDate, query.venue_id);

    const [hallPlan, deptRows, seats] = await Promise.all([
      this.prisma.hall_plans.findUnique({ where: { id: versionVenue.hall_plan_id! }, include: { venues: true } }),
      this.prisma.seating_plan_venue_departments.findMany({
        where: { version_venue_id: versionVenue.id },
        include: { departments: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.seating_arrangements.findMany({
        where: { hall_plan_id: versionVenue.hall_plan_id!, version_id: version.id },
        include: { students: { select: STUDENT_SELECT } },
        orderBy: { seat_number: 'asc' },
      }),
    ]);
    if (!hallPlan) {
      throw new NotFoundException({ message: 'Hall plan not found.', errorCode: 'HALL_PLAN_NOT_FOUND' });
    }

    const departmentIds = deptRows.map((d) => d.department_id);
    const classByDept = await this.eligibleClassesByDepartment(query.exam_id, examDate, query.session, departmentIds);
    const eligibleClassIds = [...new Set([...classByDept.values()].flatMap((s) => [...s]))];

    const alreadySeated = await this.prisma.seating_arrangements.findMany({
      where: { version_id: version.id },
      select: { student_id: true },
    });
    const alreadySeatedIds = alreadySeated.map((s) => s.student_id);

    const candidatesWaiting = eligibleClassIds.length
      ? await this.prisma.students.count({
          where: {
            class_id: { in: eligibleClassIds },
            status: 'active',
            id: alreadySeatedIds.length ? { notIn: alreadySeatedIds } : undefined,
          },
        })
      : 0;

    // Per-department breakdown for the design's "CSE 48 of 60 seated · 12
    // carried forward" row — "60" is the department's whole candidate pool
    // for this exam/session, "48" is how many landed a seat in this venue,
    // and "carried forward" is what's left of the pool once seats already
    // taken at OTHER venues in this same version are subtracted out too.
    const seatedElsewhere = departmentIds.length
      ? await this.prisma.seating_arrangements.findMany({
          where: { version_id: version.id, hall_plan_id: { not: versionVenue.hall_plan_id! } },
          select: { students: { select: { class_id: true } } },
        })
      : [];
    const deptIdByClassId = new Map<number, number>();
    for (const [deptId, classIds] of classByDept) for (const classId of classIds) deptIdByClassId.set(classId, deptId);
    const seatedElsewhereByDept = new Map<number, number>();
    for (const row of seatedElsewhere) {
      const deptId = row.students.class_id != null ? deptIdByClassId.get(row.students.class_id) : undefined;
      if (deptId != null) seatedElsewhereByDept.set(deptId, (seatedElsewhereByDept.get(deptId) ?? 0) + 1);
    }
    const seatedHereByDept = new Map<number, number>();
    for (const s of seats) {
      const deptId = s.students.class_id != null ? deptIdByClassId.get(s.students.class_id) : undefined;
      if (deptId != null) seatedHereByDept.set(deptId, (seatedHereByDept.get(deptId) ?? 0) + 1);
    }
    const departmentBreakdown = await Promise.all(
      deptRows.map(async (d) => {
        const classIds = [...(classByDept.get(d.department_id) ?? [])];
        const eligibleTotal = classIds.length
          ? await this.prisma.students.count({ where: { class_id: { in: classIds }, status: 'active' } })
          : 0;
        const seatedHere = seatedHereByDept.get(d.department_id) ?? 0;
        const poolAtThisVenue = eligibleTotal - (seatedElsewhereByDept.get(d.department_id) ?? 0);
        return {
          id: d.departments.id,
          code: d.departments.code,
          name: d.departments.name,
          seated_here: seatedHere,
          pool_at_this_venue: poolAtThisVenue,
          carried_forward: Math.max(poolAtThisVenue - seatedHere, 0),
        };
      }),
    );

    return {
      version: { id: version.id, status: version.status },
      version_venue_id: versionVenue.id,
      venue: {
        id: hallPlan.venue_id,
        name: hallPlan.venues.name,
        location: hallPlan.venues.location,
        capacity: hallPlan.capacity ?? hallPlan.venues.capacity ?? 0,
      },
      allocation_mode: versionVenue.allocation_mode,
      pattern: versionVenue.pattern,
      departments: deptRows.map((d) => ({ id: d.departments.id, code: d.departments.code, name: d.departments.name })),
      department_breakdown: departmentBreakdown,
      candidates_waiting: candidatesWaiting,
      seats: seats.map((s) => ({
        seat_number: s.seat_number,
        student_id: s.student_id,
        register_no: s.students.register_no ?? s.students.student_id_no,
        name: studentName(s.students.soa_applications),
        is_special_accommodation: s.is_special_accommodation,
      })),
    };
  }

  async configureVenue(dto: ConfigureVenueDto) {
    const examDate = new Date(dto.exam_date);
    const version = await this.getOrCreateDraftVersion(dto.exam_id, dto.exam_date, dto.session);
    if (version.status !== 'draft') {
      throw new ConflictException({ message: 'This seating plan is no longer a draft.', errorCode: 'VERSION_NOT_DRAFT' });
    }
    const versionVenue = await this.getOrCreateVersionVenue(version.id, dto.exam_id, examDate, dto.venue_id);

    const data: { allocation_mode?: any; pattern?: any } = {};
    if (dto.allocation_mode !== undefined) data.allocation_mode = dto.allocation_mode;
    if (dto.pattern !== undefined) data.pattern = dto.pattern;
    if (Object.keys(data).length > 0) {
      await this.prisma.seating_plan_version_venues.update({ where: { id: versionVenue.id }, data });
    }

    if (dto.department_ids !== undefined) {
      await this.prisma.$transaction([
        this.prisma.seating_plan_venue_departments.deleteMany({ where: { version_venue_id: versionVenue.id } }),
        ...(dto.department_ids.length
          ? [
              this.prisma.seating_plan_venue_departments.createMany({
                data: dto.department_ids.map((id) => ({ version_venue_id: versionVenue.id, department_id: id })),
              }),
            ]
          : []),
      ]);
    }

    return this.getVenueDetail({ exam_id: dto.exam_id, exam_date: dto.exam_date, session: dto.session, venue_id: dto.venue_id });
  }

  async allocateAutomatic(dto: TargetVenueDto) {
    const examDate = new Date(dto.exam_date);
    const version = await this.getOrCreateDraftVersion(dto.exam_id, dto.exam_date, dto.session);
    if (version.status !== 'draft') {
      throw new ConflictException({ message: 'This seating plan is no longer a draft.', errorCode: 'VERSION_NOT_DRAFT' });
    }
    const versionVenue = await this.getOrCreateVersionVenue(version.id, dto.exam_id, examDate, dto.venue_id);
    const hallPlan = await this.prisma.hall_plans.findUnique({ where: { id: versionVenue.hall_plan_id! }, include: { venues: true } });
    if (!hallPlan) {
      throw new NotFoundException({ message: 'Hall plan not found.', errorCode: 'HALL_PLAN_NOT_FOUND' });
    }
    const capacity = hallPlan.capacity ?? hallPlan.venues.capacity ?? 0;

    const deptRows = await this.prisma.seating_plan_venue_departments.findMany({
      where: { version_venue_id: versionVenue.id },
      orderBy: { id: 'asc' },
    });
    const departmentIds = deptRows.map((d) => d.department_id);
    if (departmentIds.length === 0) {
      throw new UnprocessableEntityException({
        message: 'Tick at least one department allowed in this venue before allocating.',
        errorCode: 'NO_DEPARTMENTS_SELECTED',
      });
    }

    const classByDept = await this.eligibleClassesByDepartment(dto.exam_id, examDate, dto.session, departmentIds);
    const alreadySeated = await this.prisma.seating_arrangements.findMany({
      where: { version_id: version.id },
      select: { student_id: true },
    });
    const alreadySeatedIds = alreadySeated.map((s) => s.student_id);

    const deptQueues: number[][] = [];
    for (const deptId of departmentIds) {
      const classIds = [...(classByDept.get(deptId) ?? [])];
      const students = classIds.length
        ? await this.prisma.students.findMany({
            where: { class_id: { in: classIds }, status: 'active', id: alreadySeatedIds.length ? { notIn: alreadySeatedIds } : undefined },
            select: { id: true },
            orderBy: { register_no: 'asc' },
          })
        : [];
      deptQueues.push(students.map((s) => s.id));
    }

    const totalCandidates = deptQueues.reduce((sum, q) => sum + q.length, 0);
    const assignment = buildSeatAssignment(capacity, versionVenue.pattern, deptQueues);

    await this.prisma.$transaction([
      this.prisma.seating_arrangements.deleteMany({ where: { hall_plan_id: versionVenue.hall_plan_id!, version_id: version.id } }),
      ...(assignment.length
        ? [
            this.prisma.seating_arrangements.createMany({
              data: assignment.map((a) => ({
                hall_plan_id: versionVenue.hall_plan_id!,
                student_id: a.studentId,
                seat_number: a.seatLabel,
                version_id: version.id,
              })),
            }),
          ]
        : []),
    ]);

    return { seated: assignment.length, capacity, carried_forward: totalCandidates - assignment.length };
  }

  async allocateManual(dto: AllocateManualDto) {
    const examDate = new Date(dto.exam_date);
    const version = await this.getOrCreateDraftVersion(dto.exam_id, dto.exam_date, dto.session);
    if (version.status !== 'draft') {
      throw new ConflictException({ message: 'This seating plan is no longer a draft.', errorCode: 'VERSION_NOT_DRAFT' });
    }
    const versionVenue = await this.getOrCreateVersionVenue(version.id, dto.exam_id, examDate, dto.venue_id);
    const hallPlan = await this.prisma.hall_plans.findUnique({ where: { id: versionVenue.hall_plan_id! }, include: { venues: true } });
    if (!hallPlan) {
      throw new NotFoundException({ message: 'Hall plan not found.', errorCode: 'HALL_PLAN_NOT_FOUND' });
    }
    const capacity = hallPlan.capacity ?? hallPlan.venues.capacity ?? 0;

    const registerNumbers = [...new Set(dto.entries.flatMap((e) => expandRegisterRange(e.trim())).filter(Boolean))];

    const students = registerNumbers.length
      ? await this.prisma.students.findMany({
          where: { OR: [{ register_no: { in: registerNumbers } }, { student_id_no: { in: registerNumbers } }] },
          select: { id: true, register_no: true, student_id_no: true },
        })
      : [];
    const byRegNo = new Map(students.map((s) => [s.register_no ?? s.student_id_no, s]));
    const ordered = registerNumbers.map((r) => byRegNo.get(r)).filter((s): s is (typeof students)[number] => !!s);
    const notFound = registerNumbers.filter((r) => !byRegNo.has(r));
    const toSeat = ordered.slice(0, capacity);

    await this.prisma.$transaction([
      this.prisma.seating_arrangements.deleteMany({ where: { hall_plan_id: versionVenue.hall_plan_id!, version_id: version.id } }),
      ...(toSeat.length
        ? [
            this.prisma.seating_arrangements.createMany({
              data: toSeat.map((s, i) => ({
                hall_plan_id: versionVenue.hall_plan_id!,
                student_id: s.id,
                seat_number: seatLabelFor(i),
                version_id: version.id,
              })),
            }),
          ]
        : []),
    ]);

    return { seated: toSeat.length, capacity, carried_forward: ordered.length - toSeat.length, not_found: notFound };
  }

  async clearVenue(dto: TargetVenueDto) {
    const examDate = new Date(dto.exam_date);
    const version = await this.getOrCreateDraftVersion(dto.exam_id, dto.exam_date, dto.session);
    const versionVenue = await this.getOrCreateVersionVenue(version.id, dto.exam_id, examDate, dto.venue_id);
    const result = await this.prisma.seating_arrangements.deleteMany({
      where: { hall_plan_id: versionVenue.hall_plan_id!, version_id: version.id },
    });
    return { deleted: result.count };
  }

  async listVersions(query: ListVersionsQueryDto) {
    return this.prisma.seating_plan_versions.findMany({
      where: { exam_id: query.exam_id, status: query.status as any },
      orderBy: [{ exam_date: 'desc' }, { version_number: 'desc' }],
      include: {
        exams: { select: { id: true, academic_year: true, semester: true, exam_types: { select: { name: true } } } },
        seating_plan_version_venues: {
          include: {
            venues: { select: { name: true, location: true } },
            seating_plan_venue_departments: { include: { departments: { select: { code: true } } } },
          },
        },
        _count: { select: { seating_arrangements: true } },
      },
    });
  }

  async submitVersion(id: number) {
    const version = await this.prisma.seating_plan_versions.findUnique({ where: { id } });
    if (!version) {
      throw new NotFoundException({ message: 'Seating plan version not found.', errorCode: 'SEATING_VERSION_NOT_FOUND' });
    }
    if (version.status !== 'draft') {
      throw new ConflictException({ message: 'Only a draft can be submitted for verification.', errorCode: 'VERSION_NOT_DRAFT' });
    }
    return this.prisma.seating_plan_versions.update({ where: { id }, data: { status: 'ready_to_publish' } });
  }

  async publishVersion(id: number, userId: number) {
    const profile = await this.prisma.coe_profiles.findUnique({ where: { user_id: userId } });
    if (!profile?.is_senior) {
      throw new ForbiddenException({ message: 'Only a Senior COE can publish a seating plan.', errorCode: 'SENIOR_COE_REQUIRED' });
    }

    const version = await this.prisma.seating_plan_versions.findUnique({ where: { id } });
    if (!version) {
      throw new NotFoundException({ message: 'Seating plan version not found.', errorCode: 'SEATING_VERSION_NOT_FOUND' });
    }
    if (version.status !== 'ready_to_publish') {
      throw new ConflictException({ message: 'Only a version awaiting publish can be published.', errorCode: 'VERSION_NOT_READY' });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.seating_plan_versions.updateMany({
        where: { exam_id: version.exam_id, exam_date: version.exam_date, session: version.session, status: 'published' },
        data: { status: 'superseded' },
      });
      return tx.seating_plan_versions.update({
        where: { id },
        data: { status: 'published', published_by_user_id: userId, published_at: new Date() },
      });
    });
  }
}
