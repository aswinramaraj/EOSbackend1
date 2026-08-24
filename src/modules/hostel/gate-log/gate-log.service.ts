import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { formatStudentName } from '../common/student-name.util';
import { CreateGateLogDto } from './dto/create-gate-log.dto';
import { SearchGateLogDto } from './dto/search-gate-log.dto';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toTimeOnly(date: Date): string {
  return date.toISOString().slice(11, 16);
}

const PENDING_EXIT_STUDENT_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  student_hostel_mapping: {
    select: {
      hostel_rooms: {
        select: {
          room_number: true,
          hostels: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
} satisfies Prisma.studentsSelect;

// Full identity check for the gate — everything the Gate Warden needs to
// confirm this is actually the person named on the roll number, plus who to
// call if something's wrong. There is no parent photo anywhere in the
// schema (parents are bare `users` rows with no profile of their own) —
// only `soa_applications`' father/mother name and parent_contact exist, so
// that's what's returned instead of a photo.
const LOOKUP_STUDENT_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  admission_no: true,
  gender: true,
  date_of_birth: true,
  blood_group: true,
  student_type: true,
  dayscholar_mode: true,
  vehicle_number: true,
  status: true,
  photo_url: true,
  users: { select: { email: true } },
  soa_applications: {
    select: {
      first_name: true,
      last_name: true,
      father_name: true,
      mother_name: true,
      parent_contact: true,
      student_contact: true,
      student_whatsapp: true,
      student_email: true,
    },
  },
  classes: {
    select: {
      section: true,
      current_semester: true,
      courses: { select: { name: true, code: true } },
      departments: { select: { name: true, code: true } },
    },
  },
  student_hostel_mapping: {
    select: {
      hostel_rooms: {
        select: {
          room_number: true,
          hostels: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
} satisfies Prisma.studentsSelect;

// An outing counts as "still pending exit" once approved as long as no
// check-out ledger entry has been recorded against it yet — there's no
// separate "gate_cleared" status; the Gate Warden's own check-out entry
// (created below in create()) is itself the record that they let this
// specific person out.
const PENDING_EXIT_WHERE = {
  status: 'approved',
  hostel_in_out_ledger: { none: { entry_type: 'out' } },
} satisfies Prisma.hostel_outingsWhereInput;

function studentDisplayName(student: {
  student_id_no: string;
  soa_applications: { first_name: string; last_name: string | null } | null;
}): string {
  return student.soa_applications
    ? `${student.soa_applications.first_name} ${student.soa_applications.last_name ?? ''}`.trim()
    : `Student ${student.student_id_no}`;
}

const LOG_INCLUDE = {
  students: {
    select: {
      id: true,
      student_id_no: true,
      roll_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      users: { select: { email: true } },
      student_hostel_mapping: {
        select: {
          hostel_rooms: {
            select: {
              room_number: true,
              hostels: { select: { id: true, name: true, code: true } },
            },
          },
        },
      },
    },
  },
  users: { select: { email: true } },
} satisfies Prisma.hostel_in_out_ledgerInclude;

type LogWithRelations = Prisma.hostel_in_out_ledgerGetPayload<{
  include: typeof LOG_INCLUDE;
}>;

function toLogResponse(entry: LogWithRelations) {
  const student = entry.students;
  const name = formatStudentName(
    student.soa_applications?.first_name,
    student.soa_applications?.last_name,
    student.users.email,
  );
  const room = student.student_hostel_mapping?.hostel_rooms;

  return {
    id: entry.id,
    student: {
      id: student.id,
      name,
      student_id_no: student.student_id_no,
      roll_no: student.roll_no,
    },
    hostel: room?.hostels ?? null,
    room_number: room?.room_number ?? null,
    entry_type: entry.entry_type,
    outing_id: entry.outing_id,
    recorded_at: entry.recorded_at.toISOString(),
    recorded_by: entry.users?.email ?? null,
  };
}

@Injectable()
export class GateLogService {
  private readonly logger = new Logger(GateLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel/gate-log — a factual record that a student physically
   * passed through the gate (manual warden entry; no scanner integration
   * exists in this codebase). Not tied to the outings approval workflow
   * beyond the optional outing_id link — recording a movement doesn't
   * require an approved outing to exist first, since day-to-day comings and
   * goings aren't all outing-worthy.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – student_id does not exist
   *  400 OUTING_MISMATCH   – outing_id given but belongs to a different student
   *  404 OUTING_NOT_FOUND  – outing_id given but does not exist
   */
  async create(
    dto: CreateGateLogDto,
    recordedByUserId: number,
    wardenHostelId: number | null,
  ) {
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
      select: {
        id: true,
        student_hostel_mapping: {
          select: { hostel_rooms: { select: { hostel_id: true } } },
        },
      },
    });
    // Treat "exists, but not in my hostel" the same as "doesn't exist" —
    // same 404 the residents module uses for cross-hostel access, so a
    // warden can't use this to confirm a student belongs elsewhere.
    if (
      !student ||
      (wardenHostelId != null &&
        student.student_hostel_mapping?.hostel_rooms.hostel_id !==
          wardenHostelId)
    ) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    if (dto.outing_id) {
      const outing = await this.prisma.hostel_outings.findUnique({
        where: { id: dto.outing_id },
      });
      if (!outing) {
        throw new NotFoundException({
          message: 'Outing request not found',
          errorCode: 'OUTING_NOT_FOUND',
        });
      }
      if (outing.student_id !== dto.student_id) {
        throw new BadRequestException({
          message: 'This outing request does not belong to this student',
          errorCode: 'OUTING_MISMATCH',
        });
      }
    }

    try {
      // A gate movement is a state transition, not a free-form insert. The
      // ledger previously accepted any direction at any time, so the same
      // student could be checked out twice (or checked in without ever having
      // left) and the "currently out" list — which reads the latest row — was
      // then wrong. Out must follow In, and In must follow Out.
      //
      // The whole thing runs in one transaction that first takes a row lock on
      // the student, so two desks scanning the same person at once serialise
      // instead of both passing the check and writing two 'out' rows.
      const entry = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM students WHERE id = ${dto.student_id} FOR UPDATE`;

        const latest = await tx.hostel_in_out_ledger.findFirst({
          where: { student_id: dto.student_id },
          orderBy: { recorded_at: 'desc' },
          select: { entry_type: true, recorded_at: true },
        });

        const isCurrentlyOut = latest?.entry_type === 'out';

        if (dto.entry_type === 'out' && isCurrentlyOut) {
          throw new ConflictException({
            message:
              'This student is already marked outside. Record their check-in before checking them out again.',
            errorCode: 'GATE_ALREADY_OUT',
          });
        }

        if (dto.entry_type === 'in' && !isCurrentlyOut) {
          throw new ConflictException({
            message: latest
              ? 'This student is already marked inside. There is no open check-out to close.'
              : 'This student has no recorded check-out yet, so there is nothing to check in.',
            errorCode: 'GATE_ALREADY_IN',
          });
        }

        return tx.hostel_in_out_ledger.create({
          data: {
            student_id: dto.student_id,
            entry_type: dto.entry_type,
            outing_id: dto.outing_id,
            recorded_by_user_id: recordedByUserId,
          },
          include: LOG_INCLUDE,
        });
      });

      return toLogResponse(entry);
    } catch (err) {
      // A rejected transition is a business rule, not a server fault.
      if (err instanceof ConflictException) throw err;
      this.logger.error('DB error while recording gate log entry', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /hostel/gate-log?student_id=&entry_type=&hostel_id=&page=&page_size= */
  async findAll(dto: SearchGateLogDto) {
    const { student_id, entry_type, hostel_id, page = 1, page_size = 20 } = dto;

    const where: Prisma.hostel_in_out_ledgerWhereInput = {};
    if (student_id) where.student_id = student_id;
    if (entry_type) where.entry_type = entry_type;
    if (hostel_id) {
      where.students = {
        student_hostel_mapping: { hostel_rooms: { hostel_id } },
      };
    }

    try {
      const [entries, total] = await this.prisma.$transaction([
        this.prisma.hostel_in_out_ledger.findMany({
          where,
          include: LOG_INCLUDE,
          orderBy: { recorded_at: 'desc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.hostel_in_out_ledger.count({ where }),
      ]);

      return { page, page_size, total, data: entries.map(toLogResponse) };
    } catch (err) {
      this.logger.error('DB error while fetching gate log', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel/gate-log/pending-exits — the Gate Warden's queue: every
   * outing the Hostel Warden has approved that hasn't been checked out
   * through the gate yet. Populates automatically off hostel_outings.status
   * — there's no separate hand-off step the Warden has to trigger.
   */
  async findPendingExits() {
    try {
      const outings = await this.prisma.hostel_outings.findMany({
        where: PENDING_EXIT_WHERE,
        include: { students: { select: PENDING_EXIT_STUDENT_SELECT } },
        orderBy: { created_at: 'asc' },
      });

      return outings.map((outing) => {
        const room = outing.students.student_hostel_mapping?.hostel_rooms;
        return {
          outing_id: outing.id,
          student: {
            id: outing.students.id,
            name: studentDisplayName(outing.students),
            student_id_no: outing.students.student_id_no,
            roll_no: outing.students.roll_no,
          },
          hostel: room?.hostels ?? null,
          room_number: room?.room_number ?? null,
          from_date: toDateOnly(outing.from_date),
          to_date: toDateOnly(outing.to_date),
          start_time: toTimeOnly(outing.start_time),
          return_time: outing.return_time ? toTimeOnly(outing.return_time) : null,
          reason: outing.reason,
        };
      });
    } catch (err) {
      this.logger.error('DB error while fetching pending exits', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel/gate-log/pending-returns — the mirror of pending-exits: every
   * student whose *most recent* gate movement is a check-out with no check-in
   * after it, i.e. currently outside campus. Not restricted to outing-linked
   * exits — a day scholar checked out with no outing on file still counts,
   * since they're just as much "expected back" as a hosteller. There's no
   * separate "currently out" flag anywhere; this is derived by taking each
   * student's latest ledger row and checking whether it's an "out".
   */
  async findPendingReturns() {
    let latestEntries: Prisma.hostel_in_out_ledgerGetPayload<{
      include: {
        students: { select: typeof PENDING_EXIT_STUDENT_SELECT };
        hostel_outings: { select: { to_date: true; return_time: true } };
      };
    }>[];

    try {
      latestEntries = await this.prisma.hostel_in_out_ledger.findMany({
        distinct: ['student_id'],
        orderBy: [{ student_id: 'asc' }, { recorded_at: 'desc' }],
        include: {
          students: { select: PENDING_EXIT_STUDENT_SELECT },
          hostel_outings: { select: { to_date: true, return_time: true } },
        },
      });
    } catch (err) {
      this.logger.error('DB error while fetching pending returns', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return latestEntries
      .filter((entry) => entry.entry_type === 'out')
      .map((entry) => {
        const room = entry.students.student_hostel_mapping?.hostel_rooms;
        return {
          student: {
            id: entry.students.id,
            name: studentDisplayName(entry.students),
            student_id_no: entry.students.student_id_no,
            roll_no: entry.students.roll_no,
          },
          hostel: room?.hostels ?? null,
          room_number: room?.room_number ?? null,
          outing_id: entry.outing_id,
          checked_out_at: entry.recorded_at.toISOString(),
          expected_return: entry.hostel_outings
            ? {
                to_date: toDateOnly(entry.hostel_outings.to_date),
                return_time: entry.hostel_outings.return_time
                  ? toTimeOnly(entry.hostel_outings.return_time)
                  : null,
              }
            : null,
        };
      })
      .sort((a, b) => a.checked_out_at.localeCompare(b.checked_out_at));
  }

  /**
   * GET /hostel/gate-log/search?q= — type-ahead for the gate desk.
   *
   * Matches a partial, case-insensitive term against the student's name, roll
   * number, register number and allotted room number, and returns a short
   * pick-list. This exists because the desk previously offered either a
   * dropdown of every student (unusable at this scale) or an exact-match box
   * (requires knowing the number already, and was case-sensitive).
   *
   * Capped at 25 rows: enough to choose from, small enough that a one-letter
   * term cannot pull the whole student body over the wire.
   */
  async searchStudents(term: string) {
    const q = term.trim();
    if (q.length < 2) return [];

    const contains = { contains: q, mode: 'insensitive' as const };

    try {
      const students = await this.prisma.students.findMany({
        where: {
          status: 'active',
          OR: [
            { roll_no: contains },
            { register_no: contains },
            { student_id_no: contains },
            { soa_applications: { first_name: contains } },
            { soa_applications: { last_name: contains } },
            { student_hostel_mapping: { hostel_rooms: { room_number: contains } } },
          ],
        },
        take: 25,
        orderBy: { roll_no: 'asc' },
        select: {
          id: true,
          roll_no: true,
          register_no: true,
          student_type: true,
          photo_url: true,
          soa_applications: { select: { first_name: true, last_name: true } },
          student_hostel_mapping: {
            select: {
              hostel_rooms: {
                select: { room_number: true, hostels: { select: { name: true } } },
              },
            },
          },
          classes: {
            select: { section: true, departments: { select: { code: true } } },
          },
          // Latest ledger row tells the desk which direction to default to.
          hostel_in_out_ledger: {
            orderBy: { recorded_at: 'desc' },
            take: 1,
            select: { entry_type: true },
          },
        },
      });

      return students.map((st) => ({
        student_id: st.id,
        name: [st.soa_applications?.first_name, st.soa_applications?.last_name]
          .filter(Boolean)
          .join(' ')
          .trim(),
        roll_no: st.roll_no,
        register_no: st.register_no,
        student_type: st.student_type,
        photo_url: st.photo_url,
        room_number: st.student_hostel_mapping?.hostel_rooms?.room_number ?? null,
        hostel_name: st.student_hostel_mapping?.hostel_rooms?.hostels?.name ?? null,
        class_label: st.classes
          ? `${st.classes.departments?.code ?? ''}-${st.classes.section ?? ''}`.replace(/^-|-$/g, '')
          : null,
        is_currently_out: st.hostel_in_out_ledger[0]?.entry_type === 'out',
      }));
    } catch (err) {
      this.logger.error(`DB error while searching students for "${q}"`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel/gate-log/lookup?roll_no= — what the Gate Warden pulls up
   * when a student physically reaches the gate. Works for any student, not
   * just hostellers with an approved outing (day scholars have no
   * hostel_outings row at all and still need to be logged through) —
   * `pending_outing` is just extra context to verify against when present.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – no student has this roll number
   */
  async lookupByRollNo(rollNo: string) {
    let student: Prisma.studentsGetPayload<{
      select: typeof LOOKUP_STUDENT_SELECT & {
        hostel_outings: { where: typeof PENDING_EXIT_WHERE; take: 1 };
        hostel_in_out_ledger: {
          orderBy: { recorded_at: 'desc' };
          take: 1;
          select: { entry_type: true };
        };
      };
    }> | null;

    try {
      student = await this.prisma.students.findFirst({
        // Case-insensitive, and either identifier: staff type what is printed
        // on the ID card, in whatever case, and a register number is just as
        // valid an identifier at the gate as a roll number.
        where: {
          OR: [
            { roll_no: { equals: rollNo, mode: 'insensitive' } },
            { register_no: { equals: rollNo, mode: 'insensitive' } },
          ],
        },
        select: {
          ...LOOKUP_STUDENT_SELECT,
          hostel_outings: {
            where: PENDING_EXIT_WHERE,
            orderBy: { created_at: 'desc' },
            take: 1,
          },
          hostel_in_out_ledger: {
            orderBy: { recorded_at: 'desc' },
            take: 1,
            select: { entry_type: true },
          },
        },
      });
    } catch (err) {
      this.logger.error(`DB error while looking up roll_no ${rollNo}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!student) {
      throw new NotFoundException({
        message: 'No student found with this roll number',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const room = student.student_hostel_mapping?.hostel_rooms;
    const outing = student.hostel_outings[0];
    const soa = student.soa_applications;
    const klass = student.classes;

    return {
      student: {
        id: student.id,
        name: studentDisplayName(student),
        student_id_no: student.student_id_no,
        roll_no: student.roll_no,
        register_no: student.register_no,
        admission_no: student.admission_no,
        photo_url: student.photo_url,
        gender: student.gender,
        date_of_birth: student.date_of_birth ? toDateOnly(student.date_of_birth) : null,
        blood_group: student.blood_group,
        student_type: student.student_type,
        dayscholar_mode: student.dayscholar_mode,
        vehicle_number: student.vehicle_number,
        status: student.status,
        contact: soa?.student_contact ?? null,
        whatsapp: soa?.student_whatsapp ?? null,
        email: soa?.student_email ?? student.users.email,
      },
      academics: klass
        ? {
            course: klass.courses.name,
            department: klass.departments.name,
            section: klass.section,
            semester: klass.current_semester,
          }
        : null,
      // No parent photo exists anywhere in the schema — parents are bare
      // `users` rows with no profile of their own. Name + contact number is
      // all that's available.
      parent: soa
        ? {
            father_name: soa.father_name,
            mother_name: soa.mother_name,
            contact: soa.parent_contact,
            photo_url: null,
          }
        : null,
      hostel: room?.hostels ?? null,
      room_number: room?.room_number ?? null,
      is_hosteller: student.student_hostel_mapping !== null,
      // Whether this student's own most recent gate movement is a check-out
      // with no check-in since — drives which direction (in/out) the Gate
      // Warden's UI defaults to when they pull this student up.
      is_currently_out: student.hostel_in_out_ledger[0]?.entry_type === 'out',
      pending_outing: outing
        ? {
            outing_id: outing.id,
            from_date: toDateOnly(outing.from_date),
            to_date: toDateOnly(outing.to_date),
            start_time: toTimeOnly(outing.start_time),
            return_time: outing.return_time ? toTimeOnly(outing.return_time) : null,
            reason: outing.reason,
          }
        : null,
    };
  }
}
