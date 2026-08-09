import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CloudinaryStorageProvider } from 'src/modules/storage/providers/cloudinary-storage.provider';
import { EnrollFaceDto } from './dto/enroll-face.dto';
import { RecognizeAttendanceDto } from './dto/recognize-attendance.dto';

/** "data:image/jpeg;base64,…" -> a Buffer + its content type, for upload. Returns null for anything not decodable. */
function decodeDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return { contentType: match[1], buffer: Buffer.from(match[2], 'base64') };
  } catch {
    return null;
  }
}

interface CvEnrollResponse {
  student_id: string;
  name: string;
  captured: number;
  skipped: number;
}

interface CvMarkResult {
  student_id: string;
  name: string;
  status: 'Present' | 'Absent';
}

interface CvMarkResponse {
  results: CvMarkResult[];
  banked: number;
  spoofed: number;
}

/**
 * Thin proxy in front of the Attendance-CV Flask service (see
 * ../../../../../Attendance-CV) - the ONLY thing that ever holds its
 * ATTENDANCE_CV_API_KEY/base URL. The mobile app never talks to that
 * service directly; it has no real per-user auth, just a shared key, which
 * is not safe to embed in a distributed mobile binary. Every route here is
 * gated by our own JWT+role guards first, so by the time a request reaches
 * this service the caller is already a verified, authorized faculty member.
 */
@Injectable()
export class AttendanceCvService {
  private readonly logger = new Logger(AttendanceCvService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryStorageProvider,
  ) {}

  private getBaseUrl(): string {
    return process.env.ATTENDANCE_CV_BASE_URL || 'http://127.0.0.1:5000';
  }

  private getApiKey(): string {
    const key = process.env.ATTENDANCE_CV_API_KEY;
    if (!key) {
      throw new ServiceUnavailableException({
        message: 'Face recognition service is not configured',
        errorCode: 'ATTENDANCE_CV_NOT_CONFIGURED',
      });
    }
    return key;
  }

  private async callCv<T>(path: string, body: unknown): Promise<T> {
    // Resolved BEFORE the try/catch below - that one is specifically for
    // network failures reaching the CV service, not for "we're not even
    // configured to try", which would otherwise get misreported as the
    // same ATTENDANCE_CV_UNREACHABLE.
    const apiKey = this.getApiKey();
    const baseUrl = this.getBaseUrl();

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.logger.error(`Attendance-CV service unreachable at ${path}`, err);
      throw new ServiceUnavailableException({
        message: 'Face recognition service is unavailable. Please try again shortly.',
        errorCode: 'ATTENDANCE_CV_UNREACHABLE',
      });
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (payload as { error?: string }).error || 'Face recognition request failed';
      if (response.status === 404) {
        throw new NotFoundException({ message, errorCode: 'ATTENDANCE_CV_NOT_FOUND' });
      }
      if (response.status === 409) {
        throw new ConflictException({ message, errorCode: 'ATTENDANCE_CV_DUPLICATE_FACE' });
      }
      throw new BadRequestException({ message, errorCode: 'ATTENDANCE_CV_REJECTED' });
    }
    return payload as T;
  }

  /**
   * POST /me/classes/:class_id/students/:student_id/face-enrollment
   * (advisor only, via class_mentors). Forwards the captured photos to the
   * CV service's /api/enroll with an explicit student_id - the EOS
   * student_id_no (roll number) itself, not a name-derived slug - so the
   * two systems share one identifier with no separate mapping table.
   */
  async enrollStudentFace(classId: number, studentId: number, dto: EnrollFaceDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    await this.assertIsClassAdvisor(classId, faculty.id);

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        class_id: true,
        student_id_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
      },
    });
    if (!student) {
      throw new NotFoundException({ message: 'Student not found', errorCode: 'STUDENT_NOT_FOUND' });
    }
    if (student.class_id !== classId) {
      throw new BadRequestException({
        message: 'This student does not belong to this class',
        errorCode: 'STUDENT_NOT_IN_CLASS',
      });
    }

    const name = this.resolveStudentDisplayName(student);
    const cvResponse = await this.callCv<CvEnrollResponse>('/api/enroll', {
      student_id: student.student_id_no,
      name,
      images: dto.images,
    });

    await this.prisma.students.update({
      where: { id: studentId },
      data: { face_enrolled_at: new Date() },
    });

    this.logger.log(
      `Face enrollment: student=${student.student_id_no} class=${classId} captured=${cvResponse.captured} skipped=${cvResponse.skipped}`,
    );
    return {
      student_id: studentId,
      student_id_no: student.student_id_no,
      name,
      captured: cvResponse.captured,
      skipped: cvResponse.skipped,
    };
  }

  /**
   * POST /me/classes/:class_id/attendance/recognize (any faculty mapped to
   * teach dto.subject_id for this class - same check as markForClass).
   * Forwards the classroom photos to the CV service's /api/mark, which
   * returns Present/Absent for its ENTIRE enrolled roster (it has no
   * concept of "class") - this filters that down to just this class's
   * students and returns a draft. Nothing is written to attendance_records
   * here; the caller reviews/corrects the draft, then commits via the
   * existing POST /me/classes/:class_id/attendance (markForClass).
   *
   * The one side effect: when images are sent, the first one is uploaded
   * to Cloudinary as the evidence photo and its URL is returned as
   * `photo_url`, so the eventual commit can attach it without re-sending
   * or re-uploading the image. Done here (at draft time) rather than at
   * markForClass, since the photo already exists in memory from the CV
   * call above - committing shouldn't need the raw image resent just to
   * attach a URL that's already known.
   *
   * dto.images is optional - with none given, this skips the CV call
   * entirely and doubles as the plain roster fetch the mobile marking
   * screen needs as soon as a class/subject is picked, before any photo
   * exists (suggested_status: null for everyone, rather than a fabricated
   * "absent" guess with no photo evidence behind it at all).
   */
  async recognizeAttendance(classId: number, dto: RecognizeAttendanceDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    await this.assertMappedToTeach(classId, dto.subject_id, faculty.id);

    const roster = await this.prisma.students.findMany({
      where: { class_id: classId },
      select: {
        id: true,
        student_id_no: true,
        face_enrolled_at: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
      },
      orderBy: { student_id_no: 'asc' },
    });

    const hasPhotos = (dto.images?.length ?? 0) > 0;
    const cvResponse = hasPhotos
      ? await this.callCv<CvMarkResponse>('/api/mark', { images: dto.images })
      : null;
    const byStudentIdNo = new Map((cvResponse?.results ?? []).map((r) => [r.student_id, r]));

    // Evidence photo: only the first image (the primary classroom snapshot,
    // not every retry/angle sent for recognition accuracy) is kept, and
    // only after the CV service has already accepted it above - no point
    // uploading a photo the recognition step itself rejected. Cloudinary
    // failing here degrades gracefully: the draft below is still useful
    // without a photo, so this never blocks recognizeAttendance() itself -
    // the faculty can still review/commit, just without evidence attached.
    let photoUrl: string | undefined;
    if (hasPhotos) {
      const decoded = decodeDataUrl(dto.images![0]);
      if (decoded) {
        try {
          const uploaded = await this.cloudinary.upload(
            'attendance',
            `class-${classId}-subject-${dto.subject_id}-${Date.now()}.jpg`,
            decoded.buffer,
            decoded.contentType,
          );
          photoUrl = uploaded.url;
        } catch (err) {
          this.logger.warn(`Failed to upload attendance evidence photo to Cloudinary: ${err}`);
        }
      }
    }

    return {
      class_id: classId,
      subject_id: dto.subject_id,
      analyzed: hasPhotos,
      spoofed: cvResponse?.spoofed ?? 0,
      photo_url: photoUrl ?? null,
      students: roster.map((s) => {
        const match = byStudentIdNo.get(s.student_id_no);
        return {
          student_id: s.id,
          student_id_no: s.student_id_no,
          name: this.resolveStudentDisplayName(s),
          // Not yet enrolled for face recognition at all -> the CV
          // service's roster never included them, so there's nothing to
          // suggest either way - flagged distinctly from "enrolled, just
          // not seen in these photos" via has_face_data, since the faculty
          // needs to know a manual call is the ONLY input here.
          has_face_data: s.face_enrolled_at !== null,
          suggested_status: !hasPhotos ? null : match?.status === 'Present' ? 'present' : 'absent',
        };
      }),
    };
  }

  /**
   * GET /me/classes/:class_id/face-enrollment-roster (advisor of :class_id
   * only, same check as enrollStudentFace). Backs the "Enroll student
   * faces" screen's per-student list - deliberately its own small query
   * rather than reusing ClassMentorsService.getMenteeClassResult (the
   * existing, much larger "Class Result" screen's endpoint), which has no
   * reason to know about face_enrolled_at and shouldn't be extended for a
   * concern of this module's alone.
   */
  async getEnrollmentRoster(classId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    await this.assertIsClassAdvisor(classId, faculty.id);

    const roster = await this.prisma.students.findMany({
      where: { class_id: classId },
      select: {
        id: true,
        student_id_no: true,
        face_enrolled_at: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
      },
      orderBy: { student_id_no: 'asc' },
    });

    return {
      class_id: classId,
      students: roster.map((s) => ({
        student_id: s.id,
        student_id_no: s.student_id_no,
        name: this.resolveStudentDisplayName(s),
        face_enrolled_at: s.face_enrolled_at,
      })),
    };
  }

  private resolveStudentDisplayName(student: {
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { email: string };
  }): string {
    if (student.soa_applications) {
      const { first_name, last_name } = student.soa_applications;
      return last_name ? `${first_name} ${last_name}` : first_name;
    }
    return student.users.email;
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

  /** Face enrollment is deliberately advisor-only, stricter than attendance-marking itself. */
  private async assertIsClassAdvisor(classId: number, facultyId: number) {
    const mentor = await this.prisma.class_mentors.findFirst({
      where: { class_id: classId, faculty_id: facultyId },
    });
    if (!mentor) {
      throw new ForbiddenException({
        message: 'Only this class\'s advisor may enroll student faces',
        errorCode: 'NOT_CLASS_ADVISOR',
      });
    }
  }

  /** Same authorization markForClass already enforces for manual marking. */
  private async assertMappedToTeach(classId: number, subjectId: number, facultyId: number) {
    const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: { class_id: classId, subject_id: subjectId, faculty_id: facultyId },
    });
    if (!mapping) {
      throw new ForbiddenException({
        message: 'You are not assigned to teach this subject for this class',
        errorCode: 'NOT_MAPPED_TO_TEACH',
      });
    }
  }
}
