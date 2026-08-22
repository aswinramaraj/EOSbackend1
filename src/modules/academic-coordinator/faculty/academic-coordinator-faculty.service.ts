import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { WORKLOAD_THRESHOLD_HOURS } from 'src/common/constants/workload.constant';

@Injectable()
export class AcademicCoordinatorFacultyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/coordinator/faculty/:id
   *
   * Assigned courses come from faculty_subject_class_mapping (the real
   * assignment record); weekly hours per course come from timetable_slots
   * for that exact faculty+subject+class combination. Deliberately not
   * filtered by academic_year — that column is free-text VARCHAR and real
   * rows mix formats ("2025-2026" vs "2025-26") for the same year; filtering
   * on it verified live to drop 335 of 337 real mapping rows. Matches the
   * existing convention of never filtering timetable_slots by academic_year
   * for the same reason (see PrincipalDashboardService/PrincipalFacultyService).
   */
  async profile(id: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id },
      select: {
        id: true,
        prefix: true,
        first_name: true,
        last_name: true,
        designation: true,
        qualification: true,
        specialization: true,
        employment_status: true,
        employment_type: true,
        status: true,
        office_room: true,
        date_of_joining: true,
        departments: { select: { id: true, name: true, code: true } },
        users: { select: { email: true, phone: true } },
      },
    });

    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty not found',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }

    const [mappings, slots] = await Promise.all([
      this.prisma.faculty_subject_class_mapping.findMany({
        where: { faculty_id: id },
        select: {
          id: true,
          subject_id: true,
          class_id: true,
          subjects: { select: { subject_code: true, name: true } },
          classes: {
            select: {
              section: true,
              departments: { select: { code: true } },
            },
          },
        },
      }),
      this.prisma.timetable_slots.findMany({
        where: { faculty_id: id },
        select: {
          subject_id: true,
          class_id: true,
          start_time: true,
          end_time: true,
        },
      }),
    ]);

    const hoursByPair = new Map<string, number>();
    let totalHours = 0;
    for (const s of slots) {
      const hours = (s.end_time.getTime() - s.start_time.getTime()) / 3_600_000;
      totalHours += hours;
      const key = `${s.subject_id}:${s.class_id}`;
      hoursByPair.set(key, (hoursByPair.get(key) ?? 0) + hours);
    }

    const courses = mappings.map((m) => ({
      mapping_id: m.id,
      subject_code: m.subjects.subject_code,
      subject_name: m.subjects.name,
      class_label: `${m.classes.departments.code} ${m.classes.section}`,
      weekly_hours:
        Math.round(
          (hoursByPair.get(`${m.subject_id}:${m.class_id}`) ?? 0) * 10,
        ) / 10,
    }));

    return {
      id: faculty.id,
      name: [faculty.prefix, faculty.first_name, faculty.last_name]
        .filter(Boolean)
        .join(' '),
      designation: faculty.designation,
      department: faculty.departments,
      qualification: faculty.qualification,
      specialization: faculty.specialization,
      employment_status: faculty.employment_status,
      employment_type: faculty.employment_type,
      status: faculty.status,
      office_room: faculty.office_room,
      date_of_joining: faculty.date_of_joining,
      email: faculty.users.email,
      phone: faculty.users.phone,
      courses,
      weekly_load_hours: Math.round(totalHours * 10) / 10,
      weekly_load_cap_hours: WORKLOAD_THRESHOLD_HOURS,
    };
  }

  /**
   * GET /me/coordinator/faculty/workload
   *
   * "Course allocation" rows come from faculty_subject_class_mapping (the
   * real assignment records, not timetable_slots — a mapping can exist
   * before a timetable slot does). Per-allocation hours and the per-faculty
   * "Workload summary" bars are both derived from timetable_slots, same as
   * profile() above and the existing Principal-module precedent.
   */
  async workload() {
    const [mappings, slots, faculty] = await Promise.all([
      this.prisma.faculty_subject_class_mapping.findMany({
        select: {
          id: true,
          faculty_id: true,
          subject_id: true,
          class_id: true,
          faculty: {
            select: { first_name: true, last_name: true, prefix: true },
          },
          subjects: {
            select: { subject_code: true, name: true, course_type: true },
          },
          classes: {
            select: { section: true, departments: { select: { code: true } } },
          },
        },
      }),
      this.prisma.timetable_slots.findMany({
        select: {
          faculty_id: true,
          subject_id: true,
          class_id: true,
          start_time: true,
          end_time: true,
        },
      }),
      this.prisma.faculty.findMany({
        where: { status: 'active' },
        select: { id: true, first_name: true, last_name: true, prefix: true },
      }),
    ]);

    const hoursByPair = new Map<string, number>();
    const hoursByFaculty = new Map<number, number>();
    for (const s of slots) {
      const hours = (s.end_time.getTime() - s.start_time.getTime()) / 3_600_000;
      hoursByPair.set(
        `${s.subject_id}:${s.class_id}`,
        (hoursByPair.get(`${s.subject_id}:${s.class_id}`) ?? 0) + hours,
      );
      hoursByFaculty.set(
        s.faculty_id,
        (hoursByFaculty.get(s.faculty_id) ?? 0) + hours,
      );
    }

    const allocations = mappings.map((m) => {
      const facultyHours =
        Math.round((hoursByFaculty.get(m.faculty_id) ?? 0) * 10) / 10;
      return {
        mapping_id: m.id,
        subject_code: m.subjects.subject_code,
        subject_name: m.subjects.name,
        class_label: `${m.classes.departments.code} ${m.classes.section}`,
        faculty_name: [
          m.faculty.prefix,
          m.faculty.first_name,
          m.faculty.last_name,
        ]
          .filter(Boolean)
          .join(' '),
        course_type: m.subjects.course_type,
        weekly_hours:
          Math.round(
            (hoursByPair.get(`${m.subject_id}:${m.class_id}`) ?? 0) * 10,
          ) / 10,
        // "Check" reflects that faculty member's real overall load, not a per-allocation clash signal —
        // real clash detection lives on the Timetable page, not here.
        check: facultyHours > WORKLOAD_THRESHOLD_HOURS ? 'Overload' : 'OK',
      };
    });

    const summary = faculty
      .map((f) => {
        const hours = Math.round((hoursByFaculty.get(f.id) ?? 0) * 10) / 10;
        return {
          faculty_id: f.id,
          faculty_name: [f.prefix, f.first_name, f.last_name]
            .filter(Boolean)
            .join(' '),
          weekly_hours: hours,
          weekly_load_cap_hours: WORKLOAD_THRESHOLD_HOURS,
          percent: Math.min(
            100,
            Math.round((hours / WORKLOAD_THRESHOLD_HOURS) * 100),
          ),
        };
      })
      .filter((f) => f.weekly_hours > 0)
      .sort((a, b) => b.weekly_hours - a.weekly_hours);

    return { allocations, summary };
  }
}
