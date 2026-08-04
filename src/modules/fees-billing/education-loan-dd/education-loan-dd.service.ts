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
import { CreateEducationLoanDdDto } from './dto/create-education-loan-dd.dto';
import { UpdateEducationLoanDdDto } from './dto/update-education-loan-dd.dto';

@Injectable()
export class EducationLoanDdService {
  private readonly logger = new Logger(EducationLoanDdService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /education-loan-dds
   */
  async findAll() {
    try {
      return await this.prisma.education_loan_dd.findMany({
        orderBy: [{ student_fee_demand_mapping_id: 'asc' }, { id: 'asc' }],
      });
    } catch (err) {
      this.logger.error('DB error while fetching education loan DDs', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /education-loan-dds/:id
   *
   * Error cases:
   *  404 EDUCATION_LOAN_DD_NOT_FOUND – no DD with the given id
   */
  async findOne(id: number) {
    const dd = await this.findById(id);

    if (!dd) {
      throw new NotFoundException({
        message: 'Education loan DD not found',
        errorCode: 'EDUCATION_LOAN_DD_NOT_FOUND',
      });
    }

    return dd;
  }

  /**
   * GET /student-fee-demand-mappings/:id/education-loan-dds
   *
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   */
  async findAllForDemandMapping(demandMappingId: number) {
    await this.assertDemandMappingExists(demandMappingId);

    try {
      return await this.prisma.education_loan_dd.findMany({
        where: { student_fee_demand_mapping_id: demandMappingId },
        orderBy: { id: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching education loan DDs', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /student-fee-demand-mappings/:id/education-loan-dds
   *
   * status is never accepted from the client — Prisma applies the schema
   * default (`received`) automatically.
   *
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND        – no demand mapping with the given id
   *  404 USER_NOT_FOUND                       – received_by_user_id does not exist
   *  409 EDUCATION_LOAN_DD_REFERENCE_EXISTS   – dd_reference_number already used by another DD
   *  422 DD_AMOUNT_EXCEEDS_DUE_AMOUNT          – amount would exceed the demand's total_amount
   */
  async create(demandMappingId: number, dto: CreateEducationLoanDdDto) {
    const mapping = await this.assertDemandMappingExists(demandMappingId);

    if (dto.received_by_user_id !== undefined) {
      await this.assertUserExists(dto.received_by_user_id);
    }

    await this.assertReferenceNumberAvailable(dto.dd_reference_number);

    const amount = new Prisma.Decimal(dto.amount);
    await this.assertWithinDueAmount(
      demandMappingId,
      mapping.total_amount,
      amount,
    );

    try {
      return await this.prisma.education_loan_dd.create({
        data: {
          student_fee_demand_mapping_id: demandMappingId,
          dd_reference_number: dto.dd_reference_number,
          bank_name: dto.bank_name,
          amount,
          acknowledgement_receipt_no: dto.acknowledgement_receipt_no,
          received_by_user_id: dto.received_by_user_id,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating education loan DD', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PUT/PATCH /education-loan-dds/:id
   *
   * student_fee_demand_mapping_id is immutable — the DD remains attached to
   * its original demand mapping.
   *
   * Error cases:
   *  404 EDUCATION_LOAN_DD_NOT_FOUND         – no DD with the given id
   *  404 USER_NOT_FOUND                       – received_by_user_id does not exist
   *  409 EDUCATION_LOAN_DD_REFERENCE_EXISTS   – dd_reference_number already used by another DD
   *  422 DD_AMOUNT_EXCEEDS_DUE_AMOUNT          – amount would exceed the demand's total_amount
   */
  async update(id: number, dto: UpdateEducationLoanDdDto) {
    const dd = await this.findById(id);

    if (!dd) {
      throw new NotFoundException({
        message: 'Education loan DD not found',
        errorCode: 'EDUCATION_LOAN_DD_NOT_FOUND',
      });
    }

    if (dto.received_by_user_id !== undefined) {
      await this.assertUserExists(dto.received_by_user_id);
    }

    if (
      dto.dd_reference_number !== undefined &&
      dto.dd_reference_number !== dd.dd_reference_number
    ) {
      await this.assertReferenceNumberAvailable(dto.dd_reference_number, id);
    }

    const amount =
      dto.amount !== undefined ? new Prisma.Decimal(dto.amount) : undefined;

    if (amount !== undefined) {
      const mapping = await this.assertDemandMappingExists(
        dd.student_fee_demand_mapping_id,
      );
      await this.assertWithinDueAmount(
        dd.student_fee_demand_mapping_id,
        mapping.total_amount,
        amount,
        id,
      );
    }

    try {
      return await this.prisma.education_loan_dd.update({
        where: { id },
        data: {
          dd_reference_number: dto.dd_reference_number,
          bank_name: dto.bank_name,
          amount,
          status: dto.status,
          acknowledgement_receipt_no: dto.acknowledgement_receipt_no,
          received_by_user_id: dto.received_by_user_id,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating education loan DD', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /education-loan-dds/:id
   *
   * Error cases:
   *  404 EDUCATION_LOAN_DD_NOT_FOUND – no DD with the given id
   */
  async remove(id: number) {
    const dd = await this.findById(id);

    if (!dd) {
      throw new NotFoundException({
        message: 'Education loan DD not found',
        errorCode: 'EDUCATION_LOAN_DD_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.education_loan_dd.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting education loan DD', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertDemandMappingExists(demandMappingId: number) {
    let mapping: { total_amount: Prisma.Decimal } | null;

    try {
      mapping = await this.prisma.student_fee_demand_mapping.findUnique({
        where: { id: demandMappingId },
        select: { total_amount: true },
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

    if (!mapping) {
      throw new NotFoundException({
        message: 'Student fee demand mapping not found',
        errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND',
      });
    }

    return mapping;
  }

  private async assertUserExists(userId: number) {
    let user: unknown;

    try {
      user = await this.prisma.users.findUnique({ where: { id: userId } });
    } catch (err) {
      this.logger.error('DB error during user lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!user) {
      throw new NotFoundException({
        message: 'User not found',
        errorCode: 'USER_NOT_FOUND',
      });
    }
  }

  private async assertReferenceNumberAvailable(
    ddReferenceNumber: string,
    excludeId?: number,
  ) {
    let existing: { id: number } | null;

    try {
      existing = await this.prisma.education_loan_dd.findUnique({
        where: { dd_reference_number: ddReferenceNumber },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error during education loan DD reference duplicate check',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message:
          'An education loan DD with this reference number already exists',
        errorCode: 'EDUCATION_LOAN_DD_REFERENCE_EXISTS',
      });
    }
  }

  /**
   * Application-level financial integrity rule (not encoded in schema.prisma):
   * the sum of all education loan DDs recorded against a student's fee demand
   * must never exceed that demand's total_amount.
   */
  private async assertWithinDueAmount(
    demandMappingId: number,
    totalAmount: Prisma.Decimal,
    incomingAmount: Prisma.Decimal,
    excludeId?: number,
  ) {
    let committedSoFar: Prisma.Decimal;

    try {
      const result = await this.prisma.education_loan_dd.aggregate({
        where: {
          student_fee_demand_mapping_id: demandMappingId,
          ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
        },
        _sum: { amount: true },
      });

      committedSoFar = result._sum.amount ?? new Prisma.Decimal(0);
    } catch (err) {
      this.logger.error('DB error while summing education loan DDs', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    const projectedTotal = committedSoFar.plus(incomingAmount);

    if (projectedTotal.greaterThan(totalAmount)) {
      throw new UnprocessableEntityException({
        message:
          'DD amount would exceed the total amount due for this fee demand',
        errorCode: 'DD_AMOUNT_EXCEEDS_DUE_AMOUNT',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.education_loan_dd.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during education loan DD lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
