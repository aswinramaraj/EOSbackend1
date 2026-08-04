import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePurchaseIndentDto } from './dto/create-purchase-indent.dto';
import { UpdatePurchaseIndentDto } from './dto/update-purchase-indent.dto';

@Injectable()
export class PurchaseIndentsService {
  private readonly logger = new Logger(PurchaseIndentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /purchase-indents
   *
   * status is never accepted from the client — Prisma applies the schema
   * default (`submitted`) automatically.
   *
   * Error cases:
   *  404 USER_NOT_FOUND        – requested_by_user_id does not exist
   *  404 DEPARTMENT_NOT_FOUND  – department_id does not exist
   *  500 INTERNAL_ERROR        – unexpected failure (DB, etc.)
   */
  async create(dto: CreatePurchaseIndentDto) {
    await this.assertUserExists(dto.requested_by_user_id);
    await this.assertDepartmentExists(dto.department_id);

    try {
      return await this.prisma.purchase_indents.create({
        data: {
          requested_by_user_id: dto.requested_by_user_id,
          department_id: dto.department_id,
          item_name: dto.item_name,
          quantity: dto.quantity,
          purpose: dto.purpose,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating purchase indent', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /purchase-indents
   */
  async findAll() {
    try {
      return await this.prisma.purchase_indents.findMany({
        orderBy: { created_at: 'desc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching purchase indents', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /purchase-indents/:id
   *
   * Error cases:
   *  404 PURCHASE_INDENT_NOT_FOUND – no indent with the given id
   */
  async findOne(id: number) {
    const indent = await this.findById(id);

    if (!indent) {
      throw new NotFoundException({
        message: 'Purchase indent not found',
        errorCode: 'PURCHASE_INDENT_NOT_FOUND',
      });
    }

    return indent;
  }

  /**
   * PUT/PATCH /purchase-indents/:id
   *
   * Error cases:
   *  404 PURCHASE_INDENT_NOT_FOUND – no indent with the given id
   *  404 USER_NOT_FOUND            – requested_by_user_id does not exist
   *  404 DEPARTMENT_NOT_FOUND      – department_id does not exist
   */
  async update(id: number, dto: UpdatePurchaseIndentDto) {
    const indent = await this.findById(id);

    if (!indent) {
      throw new NotFoundException({
        message: 'Purchase indent not found',
        errorCode: 'PURCHASE_INDENT_NOT_FOUND',
      });
    }

    if (
      dto.requested_by_user_id !== undefined &&
      dto.requested_by_user_id !== indent.requested_by_user_id
    ) {
      await this.assertUserExists(dto.requested_by_user_id);
    }

    if (
      dto.department_id !== undefined &&
      dto.department_id !== indent.department_id
    ) {
      await this.assertDepartmentExists(dto.department_id);
    }

    try {
      return await this.prisma.purchase_indents.update({
        where: { id },
        data: {
          requested_by_user_id: dto.requested_by_user_id,
          department_id: dto.department_id,
          item_name: dto.item_name,
          quantity: dto.quantity,
          purpose: dto.purpose,
          status: dto.status,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating purchase indent', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /purchase-indents/:id
   *
   * Error cases:
   *  404 PURCHASE_INDENT_NOT_FOUND – no indent with the given id
   *  409 PURCHASE_INDENT_IN_USE    – indent is referenced by purchase_order_proposals
   */
  async remove(id: number) {
    const indent = await this.findById(id);

    if (!indent) {
      throw new NotFoundException({
        message: 'Purchase indent not found',
        errorCode: 'PURCHASE_INDENT_NOT_FOUND',
      });
    }

    let usageCount: number;

    try {
      usageCount = await this.prisma.purchase_order_proposals.count({
        where: { indent_id: id },
      });
    } catch (err) {
      this.logger.error('DB error while checking purchase indent usage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (usageCount > 0) {
      throw new ConflictException({
        message: 'This purchase indent is in use and cannot be deleted',
        errorCode: 'PURCHASE_INDENT_IN_USE',
      });
    }

    try {
      return await this.prisma.purchase_indents.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting purchase indent', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
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

  private async assertDepartmentExists(departmentId: number) {
    let department: unknown;

    try {
      department = await this.prisma.departments.findUnique({
        where: { id: departmentId },
      });
    } catch (err) {
      this.logger.error('DB error during department lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.purchase_indents.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during purchase indent lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
