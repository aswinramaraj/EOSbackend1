import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeHostelRoomService } from './me-hostel-room.service';

describe('MeHostelRoomService', () => {
  let service: MeHostelRoomService;
  let prisma: {
    students: { findUnique: jest.Mock };
    student_hostel_mapping: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      student_hostel_mapping: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeHostelRoomService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeHostelRoomService>(MeHostelRoomService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(service.getMyHostelRoom(999)).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
  });

  it('returns is_hostel_resident: false with no fabricated room data for a day scholar', async () => {
    prisma.students.findUnique.mockResolvedValue({
      id: 42,
      student_id_no: '22AD061',
      register_no: '722822109061',
      soa_applications: { first_name: 'Ashwin', last_name: 'C' },
    });
    prisma.student_hostel_mapping.findUnique.mockResolvedValue(null);

    const result = await service.getMyHostelRoom(1);

    expect(result).toEqual({
      is_hostel_resident: false,
      student_name: 'Ashwin C',
      register_no: '722822109061',
      hostel_name: null,
      room_number: null,
      room_type_name: null,
      mess_type: null,
    });
  });

  it('falls back to "Student <id_no>" when no soa_applications row is linked', async () => {
    prisma.students.findUnique.mockResolvedValue({
      id: 42,
      student_id_no: '22AD061',
      register_no: '722822109061',
      soa_applications: null,
    });
    prisma.student_hostel_mapping.findUnique.mockResolvedValue(null);

    const result = await service.getMyHostelRoom(1);

    expect(result.student_name).toBe('Student 22AD061');
  });

  it('returns real room/hostel details for a hosteller', async () => {
    prisma.students.findUnique.mockResolvedValue({
      id: 42,
      student_id_no: '23IT001',
      register_no: '722823111001',
      soa_applications: { first_name: 'Ganesh', last_name: 'A' },
    });
    prisma.student_hostel_mapping.findUnique.mockResolvedValue({
      hostel_rooms: {
        room_number: '214',
        hostels: { name: 'Block C', mess_type: 'Veg full board' },
        hostel_room_types: { name: 'Double sharing' },
      },
    });

    const result = await service.getMyHostelRoom(1);

    expect(result).toEqual({
      is_hostel_resident: true,
      student_name: 'Ganesh A',
      register_no: '722823111001',
      hostel_name: 'Block C',
      room_number: '214',
      room_type_name: 'Double sharing',
      mess_type: 'Veg full board',
    });
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockRejectedValue(new Error('connection lost'));

    await expect(service.getMyHostelRoom(1)).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
