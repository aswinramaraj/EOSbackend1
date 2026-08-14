import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { INTERNAL_ERROR } from '../common/sports-common';
import { CreateBudgetRequestDto } from './dto/create-budget-request.dto';
import { SearchBudgetRequestsDto } from './dto/search-budget-requests.dto';

const BUDGET_REQUEST_INCLUDE = {
  users_sports_budget_requests_raised_by_user_idTousers: {
    select: { id: true, email: true },
  },
  users_sports_budget_requests_reviewed_by_user_idTousers: {
    select: { id: true, email: true },
  },
} satisfies Prisma.sports_budget_requestsInclude;

type BudgetRequestWithRelations = Prisma.sports_budget_requestsGetPayload<{
  include: typeof BUDGET_REQUEST_INCLUDE;
}>;

function toBudgetRequestResponse(row: BudgetRequestWithRelations) {
  const raisedBy = row.users_sports_budget_requests_raised_by_user_idTousers;
  const reviewedBy = row.users_sports_budget_requests_reviewed_by_user_idTousers;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    amount: Number(row.amount),
    status: row.status,
    raised_by: { id: raisedBy.id, email: raisedBy.email },
    reviewed_by: reviewedBy ? { id: reviewedBy.id, email: reviewedBy.email } : null,
    reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  };
}

@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/budget-requests?status= */
  async findAll(dto: SearchBudgetRequestsDto) {
    const where: Prisma.sports_budget_requestsWhereInput = {};
    if (dto.status) where.status = dto.status;

    try {
      const rows = await this.prisma.sports_budget_requests.findMany({
        where,
        include: BUDGET_REQUEST_INCLUDE,
        orderBy: { created_at: 'desc' },
      });
      return rows.map(toBudgetRequestResponse);
    } catch (err) {
      this.logger.error('DB error while fetching budget requests', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** POST /sports-admin/budget-requests */
  async create(dto: CreateBudgetRequestDto, userId: number) {
    try {
      const row = await this.prisma.sports_budget_requests.create({
        data: {
          title: dto.title,
          description: dto.description,
          amount: dto.amount,
          budget_allocation_id: dto.budget_allocation_id,
          raised_by_user_id: userId,
        },
        include: BUDGET_REQUEST_INCLUDE,
      });
      return toBudgetRequestResponse(row);
    } catch (err) {
      this.logger.error('DB error while creating budget request', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/budget-requests/:id
   *
   * Error cases:
   *  404 BUDGET_REQUEST_NOT_FOUND – no budget request with this id
   */
  async findOne(id: number) {
    const row = await this.findById(id);
    if (!row) {
      throw new NotFoundException({
        message: 'Budget request not found',
        errorCode: 'BUDGET_REQUEST_NOT_FOUND',
      });
    }
    return toBudgetRequestResponse(row);
  }

  /**
   * POST /sports-admin/budget-requests/:id/approve
   *
   * Error cases:
   *  404 BUDGET_REQUEST_NOT_FOUND – no budget request with this id
   *  409 BUDGET_REQUEST_ALREADY_DECIDED – request is not currently pending
   */
  async approve(id: number, userId: number) {
    return this.decide(id, 'approved', userId);
  }

  /** POST /sports-admin/budget-requests/:id/reject — same error cases as approve. */
  async reject(id: number, userId: number) {
    return this.decide(id, 'rejected', userId);
  }

  private async decide(
    id: number,
    status: 'approved' | 'rejected',
    userId: number,
  ) {
    let existing: { status: string } | null;
    try {
      existing = await this.prisma.sports_budget_requests.findUnique({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error during budget request lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!existing) {
      throw new NotFoundException({
        message: 'Budget request not found',
        errorCode: 'BUDGET_REQUEST_NOT_FOUND',
      });
    }

    if (existing.status !== 'pending') {
      throw new ConflictException({
        message: 'This budget request has already been decided',
        errorCode: 'BUDGET_REQUEST_ALREADY_DECIDED',
      });
    }

    try {
      const updated = await this.prisma.sports_budget_requests.update({
        where: { id },
        data: {
          status,
          reviewed_by_user_id: userId,
          reviewed_at: new Date(),
        },
        include: BUDGET_REQUEST_INCLUDE,
      });
      return toBudgetRequestResponse(updated);
    } catch (err) {
      this.logger.error('DB error while deciding budget request', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.sports_budget_requests.findUnique({
        where: { id },
        include: BUDGET_REQUEST_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during budget request lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
