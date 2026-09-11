import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AccessToken } from 'livekit-server-sdk';
import { PrismaService } from 'src/prisma/prisma.service';
import { StartOnlineClassDto } from './dto/start-online-class.dto';
import { ScheduleOnlineClassDto } from './dto/schedule-online-class.dto';

type OnlineClassRow = {
  id: number;
  subject_id: number;
  class_id: number;
  faculty_id: number;
  class_date: Date;
  period_number: number | null;
  status: 'scheduled' | 'live' | 'completed';
  livekit_room_name: string;
  scheduled_at: Date | null;
  title: string | null;
  started_at: Date | null;
  ended_at: Date | null;
};

type LiveKitJoinInfo = { onlineClassId: number; roomName: string; serverUrl: string; token: string };

// online_classes / online_class_participants are manual-SQL tables (see
// prisma/manual-sql/online_classes.sql) - not schema.prisma models, per
// this project's "never modify schema.prisma for a small additive table"
// convention (doubly true right now since schema.prisma has an unrelated,
// in-progress merge conflict on this machine) - so every query here is raw
// SQL via PrismaService's $queryRaw/$executeRaw, same pattern as
// StationaryService.
@Injectable()
export class OnlineClassService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // FACULTY / HOD
  // ============================================================

  /**
   * POST /online-classes/start — creates today's session for a subject the
   * caller teaches (or reactivates it if already completed today), joins
   * the caller into it, and returns their own LiveKit token.
   */
  async startClass(userId: number, dto: StartOnlineClassDto): Promise<LiveKitJoinInfo> {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: { faculty_id: faculty.id, subject_id: dto.subject_id, class_id: dto.class_id },
      orderBy: { academic_year: 'desc' },
    });
    if (!mapping) {
      throw new ForbiddenException(
        `You are not assigned to teach subject ${dto.subject_id} for class ${dto.class_id}`,
      );
    }

    const today = new Date().toISOString().slice(0, 10);

    const existingRows = await this.prisma.$queryRaw<OnlineClassRow[]>`
      SELECT * FROM online_classes
      WHERE subject_id = ${dto.subject_id} AND class_id = ${dto.class_id} AND class_date = ${today}::date
    `;
    let row = existingRows[0];

    if (row && row.faculty_id !== faculty.id) {
      throw new ForbiddenException("This class was started by a different faculty member");
    }

    if (!row) {
      const roomName = `class-${dto.class_id}-subject-${dto.subject_id}-${today}`;
      const inserted = await this.prisma.$queryRaw<OnlineClassRow[]>`
        INSERT INTO online_classes (subject_id, class_id, faculty_id, class_date, livekit_room_name, status, started_at)
        VALUES (${dto.subject_id}, ${dto.class_id}, ${faculty.id}, ${today}::date, ${roomName}, 'live', now())
        RETURNING *
      `;
      row = inserted[0];
    } else if (row.status === 'completed' || row.status === 'scheduled') {
      // Covers both "start it again after it ended" and "start today's
      // scheduled meeting" - same row/id either way (started_at wasn't set
      // yet for a scheduled one, so this is when it first gets a real value).
      const reactivated = await this.prisma.$queryRaw<OnlineClassRow[]>`
        UPDATE online_classes
        SET status = 'live', started_at = now(), ended_at = null
        WHERE id = ${row.id}
        RETURNING *
      `;
      row = reactivated[0];
    }

    const token = await this.buildToken({
      identity: `faculty-${faculty.id}`,
      name: `${faculty.first_name} ${faculty.last_name}`,
      roomName: row.livekit_room_name,
    });

    await this.recordJoin(row.id, userId, 'faculty');

    return this.toJoinInfo(row, token);
  }

  /**
   * POST /online-classes/schedule — creates a future session for a subject
   * the caller teaches. Doesn't touch LiveKit at all (no token/room use
   * before the meeting is actually started) - just a DB row with
   * status='scheduled'; startClass() flips it to 'live' in place when the
   * faculty actually starts it (same UNIQUE(subject_id, class_id,
   * class_date) as the "start now" path, so only one session per
   * subject/class/day either way).
   */
  async scheduleClass(userId: number, dto: ScheduleOnlineClassDto) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: { faculty_id: faculty.id, subject_id: dto.subject_id, class_id: dto.class_id },
      orderBy: { academic_year: 'desc' },
    });
    if (!mapping) {
      throw new ForbiddenException(
        `You are not assigned to teach subject ${dto.subject_id} for class ${dto.class_id}`,
      );
    }

    const scheduledAt = new Date(dto.scheduled_at);
    if (scheduledAt.getTime() < Date.now()) {
      throw new BadRequestException({ message: 'scheduled_at must be in the future', errorCode: 'SCHEDULED_AT_IN_PAST' });
    }
    const classDate = scheduledAt.toISOString().slice(0, 10);

    const existing = await this.prisma.$queryRaw<OnlineClassRow[]>`
      SELECT id FROM online_classes
      WHERE subject_id = ${dto.subject_id} AND class_id = ${dto.class_id} AND class_date = ${classDate}::date
    `;
    if (existing[0]) {
      throw new BadRequestException({
        message: 'A session already exists for this subject and class on that day',
        errorCode: 'SESSION_ALREADY_EXISTS',
      });
    }

    const roomName = `class-${dto.class_id}-subject-${dto.subject_id}-${classDate}`;
    const rows = await this.prisma.$queryRaw<OnlineClassRow[]>`
      INSERT INTO online_classes
        (subject_id, class_id, faculty_id, class_date, livekit_room_name, status, scheduled_at, title, started_at)
      VALUES
        (${dto.subject_id}, ${dto.class_id}, ${faculty.id}, ${classDate}::date, ${roomName}, 'scheduled', ${scheduledAt}, ${dto.title ?? null}, null)
      RETURNING *
    `;
    return rows[0];
  }

  /** GET /online-classes/scheduled — the caller's own upcoming (not yet started) scheduled sessions. */
  async listMyScheduled(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    return this.prisma.$queryRaw<OnlineClassRow[]>`
      SELECT * FROM online_classes
      WHERE faculty_id = ${faculty.id} AND status = 'scheduled' AND class_date >= CURRENT_DATE
      ORDER BY scheduled_at ASC
    `;
  }

  /** POST /online-classes/:id/end — faculty (own class only) ends the session and force-closes any open attendance rows. */
  async endClass(userId: number, onlineClassId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const row = await this.getOnlineClass(onlineClassId);

    if (row.faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only end your own class session');
    }

    await this.prisma.$executeRaw`
      UPDATE online_classes SET status = 'completed', ended_at = now() WHERE id = ${onlineClassId}
    `;
    await this.closeOpenParticipantRows(onlineClassId);

    return { id: onlineClassId, status: 'completed' as const };
  }

  // ============================================================
  // STUDENT / FACULTY / HOD (shared)
  // ============================================================

  /** GET /online-classes/today — real session(s) relevant to the caller, for today only. */
  async listToday(userId: number, role: string) {
    const today = new Date().toISOString().slice(0, 10);

    if (role === 'student') {
      const student = await this.resolveStudentByUserId(userId);
      if (!student.class_id) return [];
      return this.prisma.$queryRaw<OnlineClassRow[]>`
        SELECT * FROM online_classes WHERE class_id = ${student.class_id} AND class_date = ${today}::date
      `;
    }

    const faculty = await this.resolveFacultyByUserId(userId);
    return this.prisma.$queryRaw<OnlineClassRow[]>`
      SELECT * FROM online_classes WHERE faculty_id = ${faculty.id} AND class_date = ${today}::date
    `;
  }

  /** POST /online-classes/:id/join — student (or the owning faculty rejoining) gets their own LiveKit token. */
  async joinClass(userId: number, role: string, onlineClassId: number): Promise<LiveKitJoinInfo> {
    const row = await this.getOnlineClass(onlineClassId);
    if (row.status !== 'live') {
      throw new BadRequestException({ message: 'This class is not live', errorCode: 'CLASS_NOT_LIVE' });
    }

    let identity: string;
    let name: string;
    let participantRole: 'faculty' | 'student';

    if (role === 'student') {
      const student = await this.resolveStudentByUserId(userId);
      if (student.class_id !== row.class_id) {
        throw new ForbiddenException('This class is not for your section');
      }
      identity = `student-${student.id}`;
      name = student.name;
      participantRole = 'student';
    } else {
      const faculty = await this.resolveFacultyByUserId(userId);
      if (faculty.id !== row.faculty_id) {
        throw new ForbiddenException('You may only join your own class session');
      }
      identity = `faculty-${faculty.id}`;
      name = `${faculty.first_name} ${faculty.last_name}`;
      participantRole = 'faculty';
    }

    const token = await this.buildToken({ identity, name, roomName: row.livekit_room_name });
    await this.recordJoin(row.id, userId, participantRole);

    return this.toJoinInfo(row, token);
  }

  /** POST /online-classes/:id/leave — idempotent; closes the caller's own most recent open attendance row, if any. */
  async leaveClass(userId: number, onlineClassId: number) {
    await this.prisma.$executeRaw`
      UPDATE online_class_participants
      SET left_at = now(), duration_seconds = EXTRACT(EPOCH FROM (now() - joined_at))::int
      WHERE id = (
        SELECT id FROM online_class_participants
        WHERE online_class_id = ${onlineClassId} AND user_id = ${userId} AND left_at IS NULL
        ORDER BY joined_at DESC
        LIMIT 1
      )
    `;
    return { id: onlineClassId, left: true };
  }

  // ============================================================
  // Shared helpers
  // ============================================================

  private async buildToken(opts: { identity: string; name: string; roomName: string }): Promise<string> {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new InternalServerErrorException({ message: 'LiveKit is not configured', errorCode: 'LIVEKIT_NOT_CONFIGURED' });
    }
    const at = new AccessToken(apiKey, apiSecret, { identity: opts.identity, name: opts.name, ttl: '4h' });
    at.addGrant({ room: opts.roomName, roomJoin: true, canPublish: true, canSubscribe: true });
    return at.toJwt();
  }

  private toJoinInfo(row: OnlineClassRow, token: string): LiveKitJoinInfo {
    const serverUrl = process.env.LIVEKIT_URL;
    if (!serverUrl) {
      throw new InternalServerErrorException({ message: 'LiveKit is not configured', errorCode: 'LIVEKIT_NOT_CONFIGURED' });
    }
    return { onlineClassId: row.id, roomName: row.livekit_room_name, serverUrl, token };
  }

  private async recordJoin(onlineClassId: number, userId: number, role: 'faculty' | 'student') {
    await this.prisma.$executeRaw`
      INSERT INTO online_class_participants (online_class_id, user_id, role)
      VALUES (${onlineClassId}, ${userId}, ${role})
    `;
  }

  private async closeOpenParticipantRows(onlineClassId: number) {
    await this.prisma.$executeRaw`
      UPDATE online_class_participants
      SET left_at = now(), duration_seconds = EXTRACT(EPOCH FROM (now() - joined_at))::int
      WHERE online_class_id = ${onlineClassId} AND left_at IS NULL
    `;
  }

  private async getOnlineClass(id: number): Promise<OnlineClassRow> {
    const rows = await this.prisma.$queryRaw<OnlineClassRow[]>`SELECT * FROM online_classes WHERE id = ${id}`;
    if (!rows[0]) {
      throw new NotFoundException({ message: 'Online class not found', errorCode: 'ONLINE_CLASS_NOT_FOUND' });
    }
    return rows[0];
  }

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({ where: { user_id: userId } });
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty profile not found for the authenticated user',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty;
  }

  private async resolveStudentByUserId(userId: number) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true, class_id: true, soa_applications: { select: { first_name: true, last_name: true } } },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for the authenticated user',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    const first = student.soa_applications?.first_name;
    const last = student.soa_applications?.last_name;
    return {
      id: student.id,
      class_id: student.class_id,
      name: first ? (last ? `${first} ${last}` : first) : 'Student',
    };
  }
}
