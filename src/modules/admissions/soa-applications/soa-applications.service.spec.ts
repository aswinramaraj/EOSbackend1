import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { SmsService } from 'src/common/sms/sms.service';
import {
  dayscholar_mode_enum,
  soa_status_enum,
  student_type_enum,
} from 'generated/prisma/client';
import { SoaApplicationsService } from './soa-applications.service';
import type { CreatePerfectEntryDto } from './dto/create-perfect-entry.dto';

/** Typed lookup helper — avoids `as any` when parameterizing tests over model names. */
function prismaModel(prisma: unknown, name: string): { findUnique: jest.Mock } {
  return (prisma as Record<string, { findUnique: jest.Mock }>)[name];
}

describe('SoaApplicationsService', () => {
  let service: SoaApplicationsService;
  let prisma: {
    soa_applications: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    students: { findUnique: jest.Mock; create: jest.Mock };
    users: { findUnique: jest.Mock; create: jest.Mock };
    courses: { findUnique: jest.Mock };
    quotas: { findUnique: jest.Mock };
    batches: { findUnique: jest.Mock };
    transport_stages: { findUnique: jest.Mock };
    hostel_room_types: { findUnique: jest.Mock };
    roles: { findUnique: jest.Mock };
    student_sensitive_info: { create: jest.Mock };
    student_identity_marks: { createMany: jest.Mock };
    student_family_details: { create: jest.Mock };
    student_contacts: { create: jest.Mock };
    student_addresses: { createMany: jest.Mock };
    student_certificates: { createMany: jest.Mock };
    admission_profile_drafts: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      soa_applications: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      students: { findUnique: jest.fn(), create: jest.fn() },
      users: { findUnique: jest.fn(), create: jest.fn() },
      courses: { findUnique: jest.fn() },
      quotas: { findUnique: jest.fn() },
      batches: { findUnique: jest.fn() },
      transport_stages: { findUnique: jest.fn() },
      hostel_room_types: { findUnique: jest.fn() },
      roles: { findUnique: jest.fn() },
      student_sensitive_info: { create: jest.fn() },
      student_identity_marks: { createMany: jest.fn() },
      student_family_details: { create: jest.fn() },
      student_contacts: { create: jest.fn() },
      student_addresses: { createMany: jest.fn() },
      student_certificates: { createMany: jest.fn() },
      admission_profile_drafts: { deleteMany: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SoaApplicationsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: { upload: jest.fn(), getSignedDownloadUrl: jest.fn() },
        },
        { provide: SmsService, useValue: { send: jest.fn() } },
      ],
    }).compile();

    service = module.get<SoaApplicationsService>(SoaApplicationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates an SOA application with only first_name provided', async () => {
    prisma.soa_applications.create.mockResolvedValue({
      id: 1042,
      first_name: 'Arjun',
      status: 'applied',
    });

    const result = await service.create({ first_name: 'Arjun' });

    expect(prisma.soa_applications.create).toHaveBeenCalledWith({
      data: { first_name: 'Arjun' },
    });
    expect(result).toEqual({
      id: 1042,
      first_name: 'Arjun',
      status: 'applied',
    });
  });

  it('passes through all provided fields verbatim to the insert', async () => {
    prisma.soa_applications.create.mockResolvedValue({ id: 2 });
    const dto = {
      first_name: 'Arjun',
      last_name: 'Kumar',
      parent_contact: '9876543210',
      student_email: 'arjun.k@example.com',
      cutoff_physics: 92.5,
      cutoff_chemistry: 88,
      cutoff_maths: 95.5,
      community: 'OC',
    };

    await service.create(dto);

    expect(prisma.soa_applications.create).toHaveBeenCalledWith({ data: dto });
  });

  it.each([
    ['cutoff_physics', -1],
    ['cutoff_chemistry', 100.01],
    ['cutoff_maths', 150],
  ])(
    'throws 422 INVALID_CUTOFF_RANGE when %s = %s is outside 0-100',
    async (field: string, value: number) => {
      await expect(
        service.create({ first_name: 'Arjun', [field]: value }),
      ).rejects.toMatchObject({
        status: 422,
        response: {
          errorCode: 'INVALID_CUTOFF_RANGE',
          message: `${field} must be between 0 and 100`,
        },
      });
      expect(prisma.soa_applications.create).not.toHaveBeenCalled();
    },
  );

  it.each([0, 100])('accepts a boundary cutoff value of %s', async (value) => {
    prisma.soa_applications.create.mockResolvedValue({ id: 3 });

    await expect(
      service.create({ first_name: 'Arjun', cutoff_physics: value }),
    ).resolves.toBeDefined();
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.soa_applications.create.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(service.create({ first_name: 'Arjun' })).rejects.toMatchObject(
      {
        status: 500,
        response: { errorCode: 'INTERNAL_ERROR' },
      },
    );
  });

  describe('updateStatus', () => {
    it('throws 404 SOA_APPLICATION_NOT_FOUND when no row matches the id', async () => {
      prisma.soa_applications.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus(999, { status: 'fees_paid' }),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'SOA_APPLICATION_NOT_FOUND' },
      });
      expect(prisma.soa_applications.update).not.toHaveBeenCalled();
    });

    it.each([
      ['applied', 'fees_paid'],
      ['applied', 'cancelled'],
      ['fees_paid', 'admission_confirmed'],
      ['fees_paid', 'cancelled'],
    ])('allows %s → %s', async (currentStatus: string, nextStatus: string) => {
      prisma.soa_applications.findUnique.mockResolvedValue({
        id: 1,
        status: currentStatus,
      });
      prisma.soa_applications.update.mockResolvedValue({
        id: 1,
        status: nextStatus,
      });

      const result = await service.updateStatus(1, {
        status: nextStatus as soa_status_enum,
      });

      expect(prisma.soa_applications.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: nextStatus },
      });
      expect(result.status).toBe(nextStatus);
    });

    it.each([
      ['applied', 'admission_confirmed'],
      ['fees_paid', 'applied'],
      ['admission_confirmed', 'fees_paid'],
      ['admission_confirmed', 'cancelled'],
      ['cancelled', 'applied'],
      ['cancelled', 'fees_paid'],
      ['applied', 'applied'],
    ])(
      'rejects %s → %s as 422 INVALID_STATUS_TRANSITION',
      async (currentStatus: string, nextStatus: string) => {
        prisma.soa_applications.findUnique.mockResolvedValue({
          id: 1,
          status: currentStatus,
        });

        await expect(
          service.updateStatus(1, { status: nextStatus as soa_status_enum }),
        ).rejects.toMatchObject({
          status: 422,
          response: {
            errorCode: 'INVALID_STATUS_TRANSITION',
            message: `Cannot transition from '${currentStatus}' to '${nextStatus}'`,
          },
        });
        expect(prisma.soa_applications.update).not.toHaveBeenCalled();
      },
    );

    it('wraps a DB failure during the update as 500 INTERNAL_ERROR', async () => {
      prisma.soa_applications.findUnique.mockResolvedValue({
        id: 1,
        status: 'applied',
      });
      prisma.soa_applications.update.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        service.updateStatus(1, { status: 'fees_paid' }),
      ).rejects.toMatchObject({
        status: 500,
        response: { errorCode: 'INTERNAL_ERROR' },
      });
    });
  });

  describe('perfectEntry', () => {
    const validDto = (
      overrides: Partial<CreatePerfectEntryDto> = {},
    ): CreatePerfectEntryDto => ({
      email: 'arjun.k@student.college.edu',
      course_id: 8,
      quota_id: 2,
      batch_id: 4,
      student_id_no: 'AIDS2026041',
      student_type: 'dayscholar',
      dayscholar_mode: 'own_vehicle',
      vehicle_number: 'TN01AB1234',
      ...overrides,
    });

    function mockHappyPath() {
      prisma.soa_applications.findUnique.mockResolvedValue({
        id: 1042,
        status: 'admission_confirmed',
      });
      prisma.students.findUnique.mockResolvedValue(null);
      prisma.courses.findUnique.mockResolvedValue({ id: 8 });
      prisma.quotas.findUnique.mockResolvedValue({ id: 2 });
      prisma.batches.findUnique.mockResolvedValue({ id: 4 });
      prisma.transport_stages.findUnique.mockResolvedValue({ id: 12 });
      prisma.hostel_room_types.findUnique.mockResolvedValue({ id: 3 });
      prisma.users.findUnique.mockResolvedValue(null);
      prisma.roles.findUnique.mockResolvedValue({ id: 4, name: 'student' });
      prisma.users.create.mockResolvedValue({ id: 890 });
      prisma.students.create.mockResolvedValue({
        id: 3310,
        user_id: 890,
        student_id_no: 'AIDS2026041',
        course_id: 8,
        quota_id: 2,
        batch_id: 4,
        class_id: null,
        student_type: 'dayscholar',
        status: 'active',
      });
    }

    it('completes the transaction and returns the created student on the happy path', async () => {
      mockHappyPath();

      const result = await service.perfectEntry(1042, validDto());

      const [usersCreateArgs] = prisma.users.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      const [studentsCreateArgs] = prisma.students.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(usersCreateArgs.data).toMatchObject({
        email: 'arjun.k@student.college.edu',
        role_id: 4,
        status: 'active',
      });
      expect(studentsCreateArgs.data).toMatchObject({
        soa_application_id: 1042,
        user_id: 890,
      });
      expect(result).toEqual(
        expect.objectContaining({
          id: 3310,
          student_id_no: 'AIDS2026041',
          status: 'active',
        }),
      );
    });

    it('throws 404 SOA_APPLICATION_NOT_FOUND when the application does not exist', async () => {
      prisma.soa_applications.findUnique.mockResolvedValue(null);

      await expect(service.perfectEntry(999, validDto())).rejects.toMatchObject(
        {
          status: 404,
          response: { errorCode: 'SOA_APPLICATION_NOT_FOUND' },
        },
      );
    });

    it.each(['applied', 'fees_paid', 'cancelled'])(
      'throws 422 PERFECT_ENTRY_NOT_ALLOWED when application status is %s',
      async (status) => {
        prisma.soa_applications.findUnique.mockResolvedValue({
          id: 1042,
          status,
        });

        await expect(
          service.perfectEntry(1042, validDto()),
        ).rejects.toMatchObject({
          status: 422,
          response: { errorCode: 'PERFECT_ENTRY_NOT_ALLOWED' },
        });
      },
    );

    it('throws 409 PERFECT_ENTRY_ALREADY_DONE when a student is already linked to this application', async () => {
      prisma.soa_applications.findUnique.mockResolvedValue({
        id: 1042,
        status: 'admission_confirmed',
      });
      prisma.students.findUnique.mockResolvedValue({
        id: 1,
        soa_application_id: 1042,
      });

      await expect(
        service.perfectEntry(1042, validDto()),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'PERFECT_ENTRY_ALREADY_DONE' },
      });
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it.each([
      ['course_id', 'courses', 'COURSE_NOT_FOUND'],
      ['quota_id', 'quotas', 'QUOTA_NOT_FOUND'],
      ['batch_id', 'batches', 'BATCH_NOT_FOUND'],
    ])(
      'throws 404 %s → %s → %s when the referenced row does not exist',
      async (_field, model, errorCode) => {
        mockHappyPath();
        prismaModel(prisma, model).findUnique.mockResolvedValue(null);

        await expect(
          service.perfectEntry(1042, validDto()),
        ).rejects.toMatchObject({
          status: 404,
          response: { errorCode },
        });
        expect(prisma.users.create).not.toHaveBeenCalled();
      },
    );

    it('throws 404 TRANSPORT_STAGE_NOT_FOUND when dayscholar_mode=transport references a missing stage', async () => {
      mockHappyPath();
      prisma.transport_stages.findUnique.mockResolvedValue(null);

      await expect(
        service.perfectEntry(
          1042,
          validDto({
            dayscholar_mode: dayscholar_mode_enum.transport,
            vehicle_number: undefined,
            transport_stage_id: 12,
          }),
        ),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'TRANSPORT_STAGE_NOT_FOUND' },
      });
    });

    it('throws 404 HOSTEL_ROOM_TYPE_NOT_FOUND for a hosteller referencing a missing room type', async () => {
      mockHappyPath();
      prisma.hostel_room_types.findUnique.mockResolvedValue(null);

      await expect(
        service.perfectEntry(
          1042,
          validDto({
            student_type: student_type_enum.hosteller,
            dayscholar_mode: undefined,
            vehicle_number: undefined,
            hostel_room_type_id: 3,
          }),
        ),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'HOSTEL_ROOM_TYPE_NOT_FOUND' },
      });
    });

    it.each([
      ['email', 'users', 'EMAIL_ALREADY_EXISTS'],
      ['student_id_no', 'students', 'STUDENT_ID_NO_ALREADY_EXISTS'],
    ])(
      'throws 409 %s → %s → %s on a uniqueness collision',
      async (field, model, errorCode) => {
        mockHappyPath();
        prismaModel(prisma, model).findUnique.mockImplementation(
          ({ where }: { where: Record<string, unknown> }) =>
            Promise.resolve(field in where ? { id: 999 } : null),
        );

        await expect(
          service.perfectEntry(1042, validDto()),
        ).rejects.toMatchObject({
          status: 409,
          response: { errorCode },
        });
        expect(prisma.users.create).not.toHaveBeenCalled();
      },
    );

    const missingConditionalFieldCases: [
      Partial<CreatePerfectEntryDto>,
      string,
    ][] = [
      [
        { dayscholar_mode: undefined },
        'dayscholar_mode is required when student_type is dayscholar',
      ],
      [
        {
          dayscholar_mode: dayscholar_mode_enum.own_vehicle,
          vehicle_number: undefined,
        },
        'vehicle_number is required when dayscholar_mode is own_vehicle',
      ],
      [
        {
          dayscholar_mode: dayscholar_mode_enum.transport,
          vehicle_number: undefined,
          transport_stage_id: undefined,
        },
        'transport_stage_id is required when dayscholar_mode is transport',
      ],
    ];

    it.each(missingConditionalFieldCases)(
      'throws 422 MISSING_CONDITIONAL_FIELD for %j',
      async (overrides, message) => {
        mockHappyPath();

        await expect(
          service.perfectEntry(1042, validDto(overrides)),
        ).rejects.toMatchObject({
          status: 422,
          response: { errorCode: 'MISSING_CONDITIONAL_FIELD', message },
        });
      },
    );

    it('throws 422 MISSING_CONDITIONAL_FIELD when hosteller omits hostel_room_type_id', async () => {
      mockHappyPath();

      await expect(
        service.perfectEntry(
          1042,
          validDto({
            student_type: student_type_enum.hosteller,
            dayscholar_mode: undefined,
            vehicle_number: undefined,
          }),
        ),
      ).rejects.toMatchObject({
        status: 422,
        response: {
          errorCode: 'MISSING_CONDITIONAL_FIELD',
          message:
            'hostel_room_type_id is required when student_type is hosteller',
        },
      });
    });

    it('throws 422 MISSING_CONDITIONAL_FIELD when is_father_exserviceman is true without exserviceman_info', async () => {
      mockHappyPath();

      await expect(
        service.perfectEntry(1042, validDto({ is_father_exserviceman: true })),
      ).rejects.toMatchObject({
        status: 422,
        response: {
          errorCode: 'MISSING_CONDITIONAL_FIELD',
          message:
            'exserviceman_info is required when is_father_exserviceman is true',
        },
      });
    });

    it('drops stale dayscholar fields when student_type is ultimately hosteller', async () => {
      mockHappyPath();

      await service.perfectEntry(
        1042,
        validDto({
          student_type: 'hosteller',
          dayscholar_mode: undefined,
          vehicle_number: undefined,
          hostel_room_type_id: 3,
        }),
      );

      const [studentsCreateArgs] = prisma.students.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(studentsCreateArgs.data).toMatchObject({
        dayscholar_mode: undefined,
        vehicle_number: undefined,
      });
    });

    it('throws 400 VALIDATION_ERROR for duplicate identity_marks.mark_number', async () => {
      mockHappyPath();

      await expect(
        service.perfectEntry(
          1042,
          validDto({
            identity_marks: [
              { mark_number: 1, description: 'a' },
              { mark_number: 1, description: 'b' },
            ],
          }),
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: { errorCode: 'VALIDATION_ERROR' },
      });
    });

    it('throws 400 VALIDATION_ERROR for duplicate addresses.address_type', async () => {
      mockHappyPath();

      await expect(
        service.perfectEntry(
          1042,
          validDto({
            addresses: [
              { address_type: 'permanent', address_line: 'a' },
              { address_type: 'permanent', address_line: 'b' },
            ],
          }),
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: { errorCode: 'VALIDATION_ERROR' },
      });
    });

    it('throws 422 INVALID_ADDRESS_TYPE for an address_type outside the real enum', async () => {
      mockHappyPath();

      await expect(
        service.perfectEntry(
          1042,
          validDto({
            addresses: [{ address_type: 'current', address_line: 'a' }],
          }),
        ),
      ).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'INVALID_ADDRESS_TYPE' },
      });
    });

    it('throws 400 VALIDATION_ERROR when date_of_birth is in the future', async () => {
      mockHappyPath();
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      await expect(
        service.perfectEntry(
          1042,
          validDto({ date_of_birth: futureDate.toISOString().slice(0, 10) }),
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: { errorCode: 'VALIDATION_ERROR' },
      });
    });

    it('wraps an unexpected transaction failure as 500 INTERNAL_ERROR', async () => {
      mockHappyPath();
      prisma.users.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.perfectEntry(1042, validDto()),
      ).rejects.toMatchObject({
        status: 500,
        response: { errorCode: 'INTERNAL_ERROR' },
      });
    });

    it('maps a P2002 unique-constraint race inside the transaction to 409 PERFECT_ENTRY_ALREADY_DONE', async () => {
      mockHappyPath();
      prisma.students.create.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['soa_application_id'] },
      });

      await expect(
        service.perfectEntry(1042, validDto()),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'PERFECT_ENTRY_ALREADY_DONE' },
      });
    });
  });
});
