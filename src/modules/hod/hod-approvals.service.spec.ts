jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { HodApprovalsService } from './hod-approvals.service';
import { FacultyLeavesService } from '../faculty/faculty-leaves/faculty-leaves.service';
import { FacultyOdRequestsService } from '../faculty/faculty-od-requests/faculty-od-requests.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

/** Same shape node-postgres/pg driver adapter surfaces a real Postgres
 * undefined_column error as, per pg-error.util.ts. */
function undefinedColumnError(columnName: string) {
  return { code: 'P2010', message: `column "${columnName}" does not exist` };
}

describe('HodApprovalsService — reject-reason persistence', () => {
  let service: HodApprovalsService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    departments: { findUnique: jest.Mock };
    student_leaves: { findUnique: jest.Mock; update: jest.Mock };
    od_request_hod_approvals: { findUnique: jest.Mock; update: jest.Mock };
    $executeRaw: jest.Mock;
  };
  let facultyOdRequests: { update: jest.Mock };
  const user: JwtPayload = {
    sub: 1,
    email: 'hod@eos.test',
    role: 'hod',
  } as JwtPayload;

  beforeEach(async () => {
    prisma = {
      faculty: {
        findUnique: jest.fn().mockResolvedValue({ department_id: 75 }),
      },
      departments: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 75, name: 'CS', code: 'CS' }),
      },
      student_leaves: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          status: 'faculty_approved',
          students: { classes: { department_id: 75 } },
        }),
        update: jest.fn().mockResolvedValue({ id: 10, status: 'rejected' }),
      },
      od_request_hod_approvals: {
        findUnique: jest.fn().mockResolvedValue({ id: 20, department_id: 75 }),
        update: jest.fn().mockResolvedValue({ id: 20, status: 'rejected' }),
      },
      $executeRaw: jest.fn(),
    };
    facultyOdRequests = { update: jest.fn().mockResolvedValue({ id: 30 }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HodApprovalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FacultyLeavesService, useValue: { update: jest.fn() } },
        { provide: FacultyOdRequestsService, useValue: facultyOdRequests },
      ],
    }).compile();

    service = module.get(HodApprovalsService);
  });

  it('decideOdRequest(student) still rejects successfully even when the remarks column does not exist yet', async () => {
    prisma.$executeRaw.mockRejectedValueOnce(undefinedColumnError('remarks'));

    const result = await service.decideOdRequest(
      user,
      'student',
      20,
      'rejected',
      'Clashes with duty roster',
    );

    expect(result).toEqual({ id: 20, status: 'rejected' });
    expect(prisma.od_request_hod_approvals.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 20 } }),
    );
  });

  it('decideOdRequest(student) propagates a real (non-schema-gap) database error', async () => {
    prisma.$executeRaw.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      service.decideOdRequest(
        user,
        'student',
        20,
        'rejected',
        'Clashes with duty roster',
      ),
    ).rejects.toThrow('connection reset');
  });

  it('decideOdRequest(faculty) forwards the reason as admin_remarks — a real, already-existing column', async () => {
    await service.decideOdRequest(
      user,
      'faculty',
      30,
      'rejected',
      'Already on duty elsewhere',
    );

    expect(facultyOdRequests.update).toHaveBeenCalledWith(
      30,
      {
        hod_approval_status: 'rejected',
        admin_remarks: 'Already on duty elsewhere',
      },
      user,
    );
  });

  it('decideOdRequest never calls $executeRaw when no reason was typed (optional field)', async () => {
    await service.decideOdRequest(user, 'student', 20, 'rejected');

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('decideLeaveRequest(student) still rejects successfully even when the remarks column does not exist yet', async () => {
    prisma.$executeRaw.mockRejectedValueOnce(undefinedColumnError('remarks'));

    const result = await service.decideLeaveRequest(
      user,
      'student',
      10,
      'rejected',
      'Below attendance threshold',
    );

    expect(result).toEqual({ id: 10, status: 'rejected' });
  });
});
