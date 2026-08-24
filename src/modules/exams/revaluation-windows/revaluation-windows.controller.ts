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
  UseGuards,
} from '@nestjs/common';
import { RevaluationWindowsService } from './revaluation-windows.service';
import { CreateRevaluationWindowDto } from './dto/create-revaluation-window.dto';
import { UpdateRevaluationWindowDto } from './dto/update-revaluation-window.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { ApiResponse } from 'src/common/dto/api-response.dto';

@Controller('revaluation-windows')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class RevaluationWindowsController {
  constructor(
    private readonly revaluationWindowsService: RevaluationWindowsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateRevaluationWindowDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const window = await this.revaluationWindowsService.create(dto, user.sub);
    return ApiResponse.created(
      window,
      'Revaluation window created successfully',
    );
  }

  @Get(':examId')
  findByExam(@Param('examId', ParseIntPipe) examId: number) {
    return this.revaluationWindowsService.findByExam(examId);
  }

  @Patch(':examId')
  async update(
    @Param('examId', ParseIntPipe) examId: number,
    @Body() dto: UpdateRevaluationWindowDto,
  ) {
    const window = await this.revaluationWindowsService.update(examId, dto);
    return ApiResponse.ok(window, 'Revaluation window updated successfully');
  }
}
