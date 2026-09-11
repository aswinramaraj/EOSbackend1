import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HallTicketClearanceService } from './hall-ticket-clearance.service';
import { CreateClearanceDto } from './dto/create-clearance.dto';
import { ApproveClearanceDto } from './dto/approve-clearance.dto';
import { RejectClearanceDto } from './dto/reject-clearance.dto';
import { ListClearanceQueryDto } from './dto/list-clearance-query.dto';

@Controller('hall-ticket-clearance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HallTicketClearanceController {
  constructor(
    private readonly hallTicketClearanceService: HallTicketClearanceService,
  ) {}

  /** POST /api/v1/hall-ticket-clearance — Student only. */
  @Post()
  @Roles(ROLES.STUDENT)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateClearanceDto, @CurrentUser() user: JwtPayload) {
    return this.hallTicketClearanceService.create(dto, user.sub);
  }

  /** GET /api/v1/hall-ticket-clearance/my — Student only. Own requests. */
  @Get('my')
  @Roles(ROLES.STUDENT)
  findMy(
    @Query() query: ListClearanceQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hallTicketClearanceService.findMy(query, user.sub);
  }

  /** GET /api/v1/hall-ticket-clearance/pending — HoD only, own department. */
  @Get('pending')
  @Roles(ROLES.HOD)
  findPending(
    @Query() query: ListClearanceQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hallTicketClearanceService.findPending(query, user.sub);
  }

  /** GET /api/v1/hall-ticket-clearance/:id — Student (own) / HoD (any). */
  @Get(':id')
  @Roles(ROLES.STUDENT, ROLES.HOD)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hallTicketClearanceService.findOne(id, user);
  }

  /** PATCH /api/v1/hall-ticket-clearance/:id/approve — HoD only. */
  @Patch(':id/approve')
  @Roles(ROLES.HOD)
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveClearanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hallTicketClearanceService.approve(id, dto, user.sub);
  }

  /** PATCH /api/v1/hall-ticket-clearance/:id/reject — HoD only. */
  @Patch(':id/reject')
  @Roles(ROLES.HOD)
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectClearanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hallTicketClearanceService.reject(id, dto, user.sub);
  }
}
