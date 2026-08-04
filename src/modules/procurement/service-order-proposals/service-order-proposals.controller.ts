import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { ServiceOrderProposalsService } from './service-order-proposals.service';
import { CreateServiceOrderProposalDto } from './dto/create-service-order-proposal.dto';
import { UpdateServiceOrderProposalDto } from './dto/update-service-order-proposal.dto';
import { FinanceReviewDto } from './dto/finance-review.dto';
import { HodReviewDto } from './dto/hod-review.dto';

@Controller('service-order-proposals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiceOrderProposalsController {
  constructor(
    private readonly serviceOrderProposalsService: ServiceOrderProposalsService,
  ) {}

  /**
   * POST /api/v1/service-order-proposals
   *
   * Error responses:
   *  400 VALIDATION_ERROR         – missing/invalid fields
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 SERVICE_INDENT_NOT_FOUND – indent_id does not exist
   *  404 VENDOR_NOT_FOUND         – vendor_id does not exist
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.ADMIN)
  create(@Body() dto: CreateServiceOrderProposalDto) {
    return this.serviceOrderProposalsService.create(dto);
  }

  /**
   * PATCH /api/v1/service-order-proposals/:id/finance-review
   *
   * Error responses:
   *  400 VALIDATION_ERROR                 – missing/invalid fields
   *  401 UNAUTHORIZED                     – missing/invalid access token
   *  403 FORBIDDEN                        – authenticated user is not an admin or finance
   *  404 SERVICE_ORDER_PROPOSAL_NOT_FOUND – no proposal with the given id
   *  404 USER_NOT_FOUND                   – finance_reviewed_by does not exist
   *  422 INVALID_WORKFLOW_STATE           – proposal is not currently pending
   *  500 INTERNAL_ERROR                   – unexpected server failure
   */
  @Patch(':id/finance-review')
  @Roles(ROLES.ADMIN, ROLES.FINANCE)
  financeReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FinanceReviewDto,
  ) {
    return this.serviceOrderProposalsService.financeReview(id, dto);
  }

  /**
   * PATCH /api/v1/service-order-proposals/:id/hod-review
   *
   * Error responses:
   *  400 VALIDATION_ERROR                 – missing/invalid fields
   *  401 UNAUTHORIZED                     – missing/invalid access token
   *  403 FORBIDDEN                        – authenticated user is not an admin or hod
   *  404 SERVICE_ORDER_PROPOSAL_NOT_FOUND – no proposal with the given id
   *  404 USER_NOT_FOUND                   – hod_reviewed_by does not exist
   *  422 INVALID_WORKFLOW_STATE           – proposal is not currently finance_approved
   *  500 INTERNAL_ERROR                   – unexpected server failure
   */
  @Patch(':id/hod-review')
  @Roles(ROLES.ADMIN, ROLES.HOD)
  hodReview(@Param('id', ParseIntPipe) id: number, @Body() dto: HodReviewDto) {
    return this.serviceOrderProposalsService.hodReview(id, dto);
  }

  /**
   * GET /api/v1/service-order-proposals
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  @Roles(ROLES.ADMIN, ROLES.FINANCE, ROLES.HOD)
  findAll() {
    return this.serviceOrderProposalsService.findAll();
  }

  /**
   * GET /api/v1/service-order-proposals/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED                     – missing/invalid access token
   *  403 FORBIDDEN                        – authenticated user is not an admin
   *  404 SERVICE_ORDER_PROPOSAL_NOT_FOUND – no proposal with the given id
   *  500 INTERNAL_ERROR                   – unexpected server failure
   */
  @Get(':id')
  @Roles(ROLES.ADMIN)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.serviceOrderProposalsService.findOne(id);
  }

  /**
   * PUT /api/v1/service-order-proposals/:id
   *
   * Only vendor_id may be updated here — this endpoint never changes
   * workflow state.
   *
   * Error responses:
   *  400 VALIDATION_ERROR                 – invalid fields
   *  401 UNAUTHORIZED                     – missing/invalid access token
   *  403 FORBIDDEN                        – authenticated user is not an admin
   *  404 SERVICE_ORDER_PROPOSAL_NOT_FOUND – no proposal with the given id
   *  404 VENDOR_NOT_FOUND                 – vendor_id does not exist
   *  500 INTERNAL_ERROR                   – unexpected server failure
   */
  @Put(':id')
  @Roles(ROLES.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceOrderProposalDto,
  ) {
    return this.serviceOrderProposalsService.update(id, dto);
  }

  /**
   * PATCH /api/v1/service-order-proposals/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/service-order-proposals/:id
   */
  @Patch(':id')
  @Roles(ROLES.ADMIN)
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceOrderProposalDto,
  ) {
    return this.serviceOrderProposalsService.update(id, dto);
  }

  /**
   * DELETE /api/v1/service-order-proposals/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED                     – missing/invalid access token
   *  403 FORBIDDEN                        – authenticated user is not an admin
   *  404 SERVICE_ORDER_PROPOSAL_NOT_FOUND – no proposal with the given id
   *  409 PROPOSAL_IN_USE                  – proposal already converted into a service order
   *  500 INTERNAL_ERROR                   – unexpected server failure
   */
  @Delete(':id')
  @Roles(ROLES.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.serviceOrderProposalsService.remove(id);
  }
}
