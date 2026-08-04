import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { CreateStudentFeeDemandMappingDto } from './dto/create-student-fee-demand-mapping.dto';
import { UpdateStudentFeeDemandMappingDto } from './dto/update-student-fee-demand-mapping.dto';

@Injectable()
export class StudentFeeDemandMappingService {
  private readonly logger = new Logger(StudentFeeDemandMappingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /student-fee-demand-mappings
   */
  async findAll() {
    try {
      return await this.prisma.student_fee_demand_mapping.findMany({
        orderBy: [
          { student_id: 'asc' },
          { academic_year: 'asc' },
          { semester: 'asc' },
        ],
      });
    } catch (err) {
      this.logger.error(
        'DB error while fetching student fee demand mappings',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /student-fee-demand-mappings/:id
   *
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   */
  async findOne(id: number) {
    const mapping = await this.findById(id);

    if (!mapping) {
      throw new NotFoundException({
        message: 'Student fee demand mapping not found',
        errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND',
      });
    }

    return mapping;
  }

  /**
   * POST /student-fee-demand-mappings
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND                    – student_id does not exist
   *  404 FEE_STRUCTURE_NOT_FOUND               – fee_structure_id does not exist
   *  422 FEE_STRUCTURE_HAS_NO_ITEMS            – fee structure has no fee_structure_items
   *  409 STUDENT_FEE_DEMAND_ALREADY_EXISTS     – a demand already exists for this student/structure/year/semester
   *  500 INTERNAL_ERROR                        – unexpected failure (DB, etc.)
   */
  async create(dto: CreateStudentFeeDemandMappingDto) {
    await this.assertStudentExists(dto.student_id);
    await this.assertFeeStructureExists(dto.fee_structure_id);
    await this.assertDuplicateDemand(dto);

    const totalAmount = await this.calculateTotalAmount(dto.fee_structure_id);

    try {
      return await this.prisma.student_fee_demand_mapping.create({
        data: {
          student_id: dto.student_id,
          fee_structure_id: dto.fee_structure_id,
          academic_year: dto.academic_year,
          semester: dto.semester,
          total_amount: totalAmount,
        },
      });
    } catch (err) {
      this.logger.error(
        'DB error while creating student fee demand mapping',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PUT/PATCH /student-fee-demand-mappings/:id
   *
   * Only academic_year and semester may be updated.
   * student_id, fee_structure_id, total_amount and created_at are immutable here.
   *
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   */
  async update(id: number, dto: UpdateStudentFeeDemandMappingDto) {
    const mapping = await this.findById(id);

    if (!mapping) {
      throw new NotFoundException({
        message: 'Student fee demand mapping not found',
        errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.student_fee_demand_mapping.update({
        where: { id },
        data: {
          academic_year: dto.academic_year,
          semester: dto.semester,
        },
      });
    } catch (err) {
      this.logger.error(
        'DB error while updating student fee demand mapping',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /student-fee-demand-mappings/:id
   *
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   *  409 STUDENT_FEE_DEMAND_IN_USE    – referenced by fee_payments or education_loan_dd
   */
  async remove(id: number) {
    const mapping = await this.findById(id);

    if (!mapping) {
      throw new NotFoundException({
        message: 'Student fee demand mapping not found',
        errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND',
      });
    }

    let usageCounts: number[];

    try {
      usageCounts = await Promise.all([
        this.prisma.fee_payments.count({
          where: { student_fee_demand_mapping_id: id },
        }),
        this.prisma.education_loan_dd.count({
          where: { student_fee_demand_mapping_id: id },
        }),
      ]);
    } catch (err) {
      this.logger.error(
        'DB error while checking student fee demand mapping usage',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (usageCounts.some((count) => count > 0)) {
      throw new ConflictException({
        message:
          'This student fee demand mapping is in use and cannot be deleted',
        errorCode: 'STUDENT_FEE_DEMAND_IN_USE',
      });
    }

    try {
      return await this.prisma.student_fee_demand_mapping.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error(
        'DB error while deleting student fee demand mapping',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertStudentExists(studentId: number) {
    let student: unknown;

    try {
      student = await this.prisma.students.findUnique({
        where: { id: studentId },
      });
    } catch (err) {
      this.logger.error('DB error during student lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
  }

  private async assertFeeStructureExists(feeStructureId: number) {
    let feeStructure: unknown;

    try {
      feeStructure = await this.prisma.fee_structures.findUnique({
        where: { id: feeStructureId },
      });
    } catch (err) {
      this.logger.error('DB error during fee structure lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!feeStructure) {
      throw new NotFoundException({
        message: 'Fee structure not found',
        errorCode: 'FEE_STRUCTURE_NOT_FOUND',
      });
    }
  }

  private async assertFeeStructureHasItems(feeStructureId: number) {
    let itemCount: number;

    try {
      itemCount = await this.prisma.fee_structure_items.count({
        where: { fee_structure_id: feeStructureId },
      });
    } catch (err) {
      this.logger.error('DB error while checking fee structure items', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (itemCount === 0) {
      throw new UnprocessableEntityException({
        message: 'This fee structure has no fee structure items',
        errorCode: 'FEE_STRUCTURE_HAS_NO_ITEMS',
      });
    }
  }

  private async assertDuplicateDemand(dto: CreateStudentFeeDemandMappingDto) {
    let existing: { id: number } | null;

    try {
      existing = await this.prisma.student_fee_demand_mapping.findFirst({
        where: {
          student_id: dto.student_id,
          fee_structure_id: dto.fee_structure_id,
          academic_year: dto.academic_year,
          semester: dto.semester,
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error during student fee demand duplicate check',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (existing) {
      throw new ConflictException({
        message:
          'A fee demand already exists for this student, fee structure, academic year and semester',
        errorCode: 'STUDENT_FEE_DEMAND_ALREADY_EXISTS',
      });
    }
  }

  private async calculateTotalAmount(
    feeStructureId: number,
  ): Promise<Prisma.Decimal> {
    await this.assertFeeStructureHasItems(feeStructureId);

    try {
      const result = await this.prisma.fee_structure_items.aggregate({
        where: { fee_structure_id: feeStructureId },
        _sum: { amount: true },
      });

      return result._sum.amount ?? new Prisma.Decimal(0);
    } catch (err) {
      this.logger.error('DB error while calculating total amount', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.student_fee_demand_mapping.findUnique({
        where: { id },
      });
    } catch (err) {
      this.logger.error(
        'DB error during student fee demand mapping lookup',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
