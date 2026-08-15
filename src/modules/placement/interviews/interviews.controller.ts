import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InterviewsService } from './interviews.service';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { RescheduleInterviewDto } from './dto/reschedule-interview.dto';
import { RecordInterviewResultDto } from './dto/record-interview-result.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { ROLES } from '../../../common/constants/roles.constant';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';

/**
 * Interview scheduling and result recording — created and run by the
 * Placement Cell (per worflow.md), with Admin retaining oversight access.
 */
@Controller('interviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PLACEMENT, ROLES.ADMIN)
export class InterviewsController {
  constructor(private readonly interviewsService: InterviewsService) {}

  @Get()
  list() {
    return this.interviewsService.list();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.interviewsService.findOne(id);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateInterviewDto) {
    return this.interviewsService.create(user, dto);
  }

  @Patch(':id')
  reschedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RescheduleInterviewDto,
  ) {
    return this.interviewsService.reschedule(id, dto);
  }

  @Patch(':id/result')
  recordResult(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecordInterviewResultDto,
  ) {
    return this.interviewsService.recordResult(user, id, dto);
  }
}
