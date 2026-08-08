jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { AttendanceCvService } from './attendance-cv.service';

describe('AttendanceCvService', () => {
  let service: AttendanceCvService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    class_mentors: { findFirst: jest.Mock };
    faculty_subject_class_mapping: { findFirst: jest.Mock };
    students: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  };
  let fetchMock: jest.Mock;

  function studentRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 42,
      class_id: 5,
      student_id_no: '23CS001',
      face_enrolled_at: null,
      soa_applications: { first_name: 'Arjun', last_name: 'Kumar' },
      users: { email: 'arjun@sece.ac.in' },
      ...overrides,
    };
  }

  beforeEach(async () => {
    process.env.ATTENDANCE_CV_API_KEY = 'test-key';
    process.env.ATTENDANCE_CV_BASE_URL = 'http://127.0.0.1:5000';

    prisma = {
      faculty: { findUnique: jest.fn() },
      class_mentors: { findFirst: jest.fn() },
      faculty_subject_class_mapping: { findFirst: jest.fn() },
      students: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    };

    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [AttendanceCvService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AttendanceCvService>(AttendanceCvService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('enrollStudentFace', () => {
    it('throws 404 when the caller has no faculty profile', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(service.enrollStudentFace(5, 42, { images: ['x'] }, 1)).rejects.toMatchObject({
        response: { errorCode: 'FACULTY_NOT_FOUND' },
      });
    });

    it("throws 403 NOT_CLASS_ADVISOR when the caller doesn't mentor this class", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.class_mentors.findFirst.mockResolvedValue(null);

      await expect(service.enrollStudentFace(5, 42, { images: ['x'] }, 1)).rejects.toMatchObject({
        response: { errorCode: 'NOT_CLASS_ADVISOR' },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws 404 STUDENT_NOT_FOUND when the student does not exist', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(service.enrollStudentFace(5, 42, { images: ['x'] }, 1)).rejects.toMatchObject({
        response: { errorCode: 'STUDENT_NOT_FOUND' },
      });
    });

    it('throws 400 STUDENT_NOT_IN_CLASS when the student belongs to a different class', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findUnique.mockResolvedValue(studentRow({ class_id: 99 }));

      await expect(service.enrollStudentFace(5, 42, { images: ['x'] }, 1)).rejects.toMatchObject({
        response: { errorCode: 'STUDENT_NOT_IN_CLASS' },
      });
    });

    it('throws 503 ATTENDANCE_CV_NOT_CONFIGURED when the API key env var is unset', async () => {
      delete process.env.ATTENDANCE_CV_API_KEY;
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findUnique.mockResolvedValue(studentRow());

      await expect(service.enrollStudentFace(5, 42, { images: ['x'] }, 1)).rejects.toMatchObject({
        response: { errorCode: 'ATTENDANCE_CV_NOT_CONFIGURED' },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws 503 ATTENDANCE_CV_UNREACHABLE when the fetch itself fails', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findUnique.mockResolvedValue(studentRow());
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.enrollStudentFace(5, 42, { images: ['x'] }, 1)).rejects.toMatchObject({
        response: { errorCode: 'ATTENDANCE_CV_UNREACHABLE' },
      });
    });

    it('throws 409 ATTENDANCE_CV_DUPLICATE_FACE when the CV service reports a duplicate', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findUnique.mockResolvedValue(studentRow());
      fetchMock.mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'This face already appears to be enrolled as "23cs002"' }),
      });

      await expect(service.enrollStudentFace(5, 42, { images: ['x'] }, 1)).rejects.toMatchObject({
        response: { errorCode: 'ATTENDANCE_CV_DUPLICATE_FACE' },
      });
      expect(prisma.students.update).not.toHaveBeenCalled();
    });

    it('forwards the roll number as student_id, then marks face_enrolled_at on success', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findUnique.mockResolvedValue(studentRow());
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ student_id: '23CS001', name: 'Arjun Kumar', captured: 20, skipped: 5 }),
      });

      const result = await service.enrollStudentFace(5, 42, { images: ['data:img1', 'data:img2'] }, 1);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:5000/api/enroll',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
          body: JSON.stringify({
            student_id: '23CS001',
            name: 'Arjun Kumar',
            images: ['data:img1', 'data:img2'],
          }),
        }),
      );
      expect(prisma.students.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { face_enrolled_at: expect.any(Date) },
      });
      expect(result).toEqual({
        student_id: 42,
        student_id_no: '23CS001',
        name: 'Arjun Kumar',
        captured: 20,
        skipped: 5,
      });
    });

    it('falls back to the user email when there is no soa_applications name on file', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findUnique.mockResolvedValue(
        studentRow({ soa_applications: null, users: { email: 'noname@sece.ac.in' } }),
      );
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ student_id: '23CS001', name: 'noname@sece.ac.in', captured: 10, skipped: 0 }),
      });

      await service.enrollStudentFace(5, 42, { images: ['x'] }, 1);

      const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(JSON.parse(options.body).name).toBe('noname@sece.ac.in');
    });
  });

  describe('recognizeAttendance', () => {
    it('throws 403 NOT_MAPPED_TO_TEACH when the caller has no mapping for this subject/class', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue(null);

      await expect(
        service.recognizeAttendance(5, { subject_id: 3, images: ['x'] }, 1),
      ).rejects.toMatchObject({ response: { errorCode: 'NOT_MAPPED_TO_TEACH' } });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("filters the CV service's whole-roster response down to this class, flagging enrollment state", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findMany.mockResolvedValue([
        studentRow({ id: 42, student_id_no: '23CS001', face_enrolled_at: new Date() }),
        studentRow({
          id: 43,
          student_id_no: '23CS002',
          face_enrolled_at: new Date(),
          soa_applications: { first_name: 'Divya', last_name: null },
        }),
        // Never enrolled for face recognition at all - won't appear in the
        // CV service's own roster, must not be silently treated the same
        // as "enrolled but absent".
        studentRow({ id: 44, student_id_no: '23CS003', face_enrolled_at: null, soa_applications: { first_name: 'Karthik', last_name: null } }),
      ]);
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { student_id: '23CS001', name: 'Arjun Kumar', status: 'Present' },
            { student_id: '23CS002', name: 'Divya', status: 'Absent' },
            { student_id: '99XY999', name: 'Someone in a different class', status: 'Present' },
          ],
          banked: 0,
          spoofed: 1,
        }),
      });

      const result = await service.recognizeAttendance(5, { subject_id: 3, images: ['x'] }, 1);

      expect(result.analyzed).toBe(true);
      expect(result.spoofed).toBe(1);
      expect(result.students).toEqual([
        {
          student_id: 42,
          student_id_no: '23CS001',
          name: 'Arjun Kumar',
          has_face_data: true,
          suggested_status: 'present',
        },
        {
          student_id: 43,
          student_id_no: '23CS002',
          name: 'Divya',
          has_face_data: true,
          suggested_status: 'absent',
        },
        {
          student_id: 44,
          student_id_no: '23CS003',
          name: 'Karthik',
          has_face_data: false,
          suggested_status: 'absent',
        },
      ]);
    });

    it('returns the plain roster with no suggestions and never calls the CV service when no images are given', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findMany.mockResolvedValue([
        studentRow({ id: 42, student_id_no: '23CS001', face_enrolled_at: new Date() }),
        studentRow({ id: 44, student_id_no: '23CS003', face_enrolled_at: null, soa_applications: { first_name: 'Karthik', last_name: null } }),
      ]);

      const result = await service.recognizeAttendance(5, { subject_id: 3 }, 1);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.analyzed).toBe(false);
      expect(result.spoofed).toBe(0);
      expect(result.students).toEqual([
        {
          student_id: 42,
          student_id_no: '23CS001',
          name: 'Arjun Kumar',
          has_face_data: true,
          suggested_status: null,
        },
        {
          student_id: 44,
          student_id_no: '23CS003',
          name: 'Karthik',
          has_face_data: false,
          suggested_status: null,
        },
      ]);
    });
  });

  describe('getEnrollmentRoster', () => {
    it('throws 403 NOT_CLASS_ADVISOR when the caller does not mentor this class', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.class_mentors.findFirst.mockResolvedValue(null);

      await expect(service.getEnrollmentRoster(5, 1)).rejects.toMatchObject({
        response: { errorCode: 'NOT_CLASS_ADVISOR' },
      });
      expect(prisma.students.findMany).not.toHaveBeenCalled();
    });

    it("returns the class roster with each student's face_enrolled_at", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      const enrolledAt = new Date('2026-01-10T00:00:00.000Z');
      prisma.students.findMany.mockResolvedValue([
        studentRow({ id: 42, student_id_no: '23CS001', face_enrolled_at: enrolledAt }),
        studentRow({ id: 44, student_id_no: '23CS003', face_enrolled_at: null, soa_applications: { first_name: 'Karthik', last_name: null } }),
      ]);

      const result = await service.getEnrollmentRoster(5, 1);

      expect(result).toEqual({
        class_id: 5,
        students: [
          { student_id: 42, student_id_no: '23CS001', name: 'Arjun Kumar', face_enrolled_at: enrolledAt },
          { student_id: 44, student_id_no: '23CS003', name: 'Karthik', face_enrolled_at: null },
        ],
      });
    });
  });
});
