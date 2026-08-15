import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma, borrow_status_enum } from 'generated/prisma/client';
import { INTERNAL_ERROR } from '../common/sports-common';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { SearchEquipmentDto } from './dto/search-equipment.dto';
import { IssueEquipmentDto } from './dto/issue-equipment.dto';
import { SearchEquipmentIssuesDto } from './dto/search-equipment-issues.dto';

/** Issue statuses that still count as "out on loan" (not yet returned). */
const OUTSTANDING_ISSUE_STATUSES: borrow_status_enum[] = ['borrowed', 'overdue'];

function todayDateOnly(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

const EQUIPMENT_INCLUDE = {
  sports_facilities: { select: { id: true, name: true } },
  _count: {
    select: {
      sports_equipment_issues: {
        where: { status: { in: OUTSTANDING_ISSUE_STATUSES } },
      },
    },
  },
} satisfies Prisma.sports_equipmentInclude;

type EquipmentWithRelations = Prisma.sports_equipmentGetPayload<{
  include: typeof EQUIPMENT_INCLUDE;
}>;

function toEquipmentResponse(equipment: EquipmentWithRelations) {
  const issuedCount = equipment._count.sports_equipment_issues;
  return {
    id: equipment.id,
    name: equipment.name,
    category: equipment.category,
    total_quantity: equipment.total_quantity,
    status: equipment.status,
    facility: equipment.sports_facilities
      ? { id: equipment.sports_facilities.id, name: equipment.sports_facilities.name }
      : null,
    issued_count: issuedCount,
    available_count: equipment.total_quantity - issuedCount,
    reorder_level: equipment.reorder_level,
  };
}

const EQUIPMENT_ISSUE_INCLUDE = {
  students: {
    select: {
      id: true,
      soa_applications: { select: { first_name: true, last_name: true } },
    },
  },
  faculty: { select: { id: true, first_name: true, last_name: true } },
} satisfies Prisma.sports_equipment_issuesInclude;

type EquipmentIssueWithRelations = Prisma.sports_equipment_issuesGetPayload<{
  include: typeof EQUIPMENT_ISSUE_INCLUDE;
}>;

function resolveIssuedToName(issue: EquipmentIssueWithRelations): string {
  if (issue.issued_to_type === 'student') {
    const soa = issue.students?.soa_applications;
    if (soa) {
      return soa.last_name ? `${soa.first_name} ${soa.last_name}` : soa.first_name;
    }
    return 'Unknown student';
  }
  if (issue.faculty) {
    return `${issue.faculty.first_name} ${issue.faculty.last_name}`;
  }
  return 'Unknown faculty';
}

function toEquipmentIssueResponse(issue: EquipmentIssueWithRelations) {
  return {
    id: issue.id,
    equipment_id: issue.equipment_id,
    issued_to_type: issue.issued_to_type,
    issued_to: {
      id:
        issue.issued_to_type === 'student'
          ? issue.student_id
          : issue.faculty_id,
      name: resolveIssuedToName(issue),
    },
    issued_date: issue.issued_date,
    due_date: issue.due_date,
    returned_date: issue.returned_date,
    status: issue.status,
    remarks: issue.remarks,
  };
}

@Injectable()
export class EquipmentService {
  private readonly logger = new Logger(EquipmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/equipment?status=&category=&q= */
  async findAll(dto: SearchEquipmentDto) {
    const where: Prisma.sports_equipmentWhereInput = {};
    if (dto.status) where.status = dto.status;
    if (dto.category) where.category = dto.category;
    if (dto.q) {
      where.OR = [
        { name: { contains: dto.q, mode: 'insensitive' } },
        { category: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    try {
      const equipment = await this.prisma.sports_equipment.findMany({
        where,
        include: EQUIPMENT_INCLUDE,
        orderBy: { name: 'asc' },
      });
      return equipment.map(toEquipmentResponse);
    } catch (err) {
      this.logger.error('DB error while fetching equipment', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/equipment
   *
   * Error cases:
   *  500 INTERNAL_ERROR – unexpected failure (DB, etc.)
   */
  async create(dto: CreateEquipmentDto) {
    try {
      const equipment = await this.prisma.sports_equipment.create({
        data: {
          name: dto.name,
          category: dto.category,
          total_quantity: dto.total_quantity,
          facility_id: dto.facility_id,
          reorder_level: dto.reorder_level,
          status: dto.status,
        },
        include: EQUIPMENT_INCLUDE,
      });
      return toEquipmentResponse(equipment);
    } catch (err) {
      this.logger.error('DB error while creating equipment', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/equipment/:id
   *
   * Error cases:
   *  404 EQUIPMENT_NOT_FOUND – no equipment with the given id
   */
  async findOne(id: number) {
    const equipment = await this.findById(id);
    if (!equipment) {
      throw new NotFoundException({
        message: 'Equipment not found',
        errorCode: 'EQUIPMENT_NOT_FOUND',
      });
    }
    return toEquipmentResponse(equipment);
  }

  /**
   * PATCH /sports-admin/equipment/:id
   *
   * Error cases:
   *  404 EQUIPMENT_NOT_FOUND – no equipment with the given id
   */
  async update(id: number, dto: UpdateEquipmentDto) {
    const equipment = await this.findById(id);
    if (!equipment) {
      throw new NotFoundException({
        message: 'Equipment not found',
        errorCode: 'EQUIPMENT_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.sports_equipment.update({
        where: { id },
        data: {
          name: dto.name,
          category: dto.category,
          total_quantity: dto.total_quantity,
          facility_id: dto.facility_id,
          reorder_level: dto.reorder_level,
          status: dto.status,
        },
        include: EQUIPMENT_INCLUDE,
      });
      return toEquipmentResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating equipment', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/equipment/:id
   *
   * Error cases:
   *  404 EQUIPMENT_NOT_FOUND – no equipment with the given id
   */
  async remove(id: number) {
    const equipment = await this.findById(id);
    if (!equipment) {
      throw new NotFoundException({
        message: 'Equipment not found',
        errorCode: 'EQUIPMENT_NOT_FOUND',
      });
    }

    try {
      await this.prisma.sports_equipment.delete({ where: { id } });
      return { message: 'Equipment deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting equipment', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/equipment/:id/issue
   *
   * Error cases:
   *  404 EQUIPMENT_NOT_FOUND – no equipment with the given id
   *  400 ISSUE_TARGET_REQUIRED – issued_to_type doesn't match exactly one of student_id/faculty_id
   *  409 NO_EQUIPMENT_AVAILABLE – no units of this equipment are currently available
   */
  async issue(id: number, dto: IssueEquipmentDto) {
    const equipment = await this.findById(id);
    if (!equipment) {
      throw new NotFoundException({
        message: 'Equipment not found',
        errorCode: 'EQUIPMENT_NOT_FOUND',
      });
    }

    const isStudentTarget = dto.issued_to_type === 'student';
    const targetMatches = isStudentTarget
      ? Boolean(dto.student_id) && !dto.faculty_id
      : Boolean(dto.faculty_id) && !dto.student_id;

    if (!targetMatches) {
      throw new BadRequestException({
        message:
          'Provide exactly one of student_id or faculty_id, matching issued_to_type',
        errorCode: 'ISSUE_TARGET_REQUIRED',
      });
    }

    const issuedCount = equipment._count.sports_equipment_issues;
    const availableCount = equipment.total_quantity - issuedCount;
    if (availableCount <= 0) {
      throw new ConflictException({
        message: 'No units of this equipment are currently available',
        errorCode: 'NO_EQUIPMENT_AVAILABLE',
      });
    }

    try {
      const created = await this.prisma.sports_equipment_issues.create({
        data: {
          equipment_id: id,
          issued_to_type: dto.issued_to_type,
          student_id: isStudentTarget ? dto.student_id : undefined,
          faculty_id: isStudentTarget ? undefined : dto.faculty_id,
          due_date: dto.due_date ? new Date(dto.due_date) : undefined,
        },
        include: EQUIPMENT_ISSUE_INCLUDE,
      });
      return toEquipmentIssueResponse(created);
    } catch (err) {
      this.logger.error('DB error while issuing equipment', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/equipment/issues/:issueId/return
   *
   * Error cases:
   *  404 ISSUE_NOT_FOUND – no issue with the given id
   *  409 ISSUE_ALREADY_RETURNED – this issue has already been returned
   */
  async returnIssue(issueId: number) {
    let issue: { status: string } | null;
    try {
      issue = await this.prisma.sports_equipment_issues.findUnique({
        where: { id: issueId },
      });
    } catch (err) {
      this.logger.error('DB error during equipment issue lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!issue) {
      throw new NotFoundException({
        message: 'Equipment issue not found',
        errorCode: 'ISSUE_NOT_FOUND',
      });
    }

    if (issue.status === 'returned') {
      throw new ConflictException({
        message: 'This equipment issue has already been returned',
        errorCode: 'ISSUE_ALREADY_RETURNED',
      });
    }

    try {
      const updated = await this.prisma.sports_equipment_issues.update({
        where: { id: issueId },
        data: { status: 'returned', returned_date: todayDateOnly() },
        include: EQUIPMENT_ISSUE_INCLUDE,
      });
      return toEquipmentIssueResponse(updated);
    } catch (err) {
      this.logger.error('DB error while returning equipment issue', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/equipment/:id/issues?status=
   *
   * Error cases:
   *  404 EQUIPMENT_NOT_FOUND – no equipment with the given id
   */
  async findIssues(id: number, dto: SearchEquipmentIssuesDto) {
    const equipment = await this.findById(id);
    if (!equipment) {
      throw new NotFoundException({
        message: 'Equipment not found',
        errorCode: 'EQUIPMENT_NOT_FOUND',
      });
    }

    const where: Prisma.sports_equipment_issuesWhereInput = {
      equipment_id: id,
    };
    if (dto.status) where.status = dto.status;

    try {
      const issues = await this.prisma.sports_equipment_issues.findMany({
        where,
        include: EQUIPMENT_ISSUE_INCLUDE,
        orderBy: { issued_date: 'desc' },
      });
      return issues.map(toEquipmentIssueResponse);
    } catch (err) {
      this.logger.error('DB error while fetching equipment issues', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.sports_equipment.findUnique({
        where: { id },
        include: EQUIPMENT_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during equipment lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
