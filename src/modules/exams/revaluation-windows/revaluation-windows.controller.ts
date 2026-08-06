import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { RevaluationWindowsService } from './revaluation-windows.service';
import { UpdateRevaluationWindowDto } from './dto/update-revaluation-window.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SeniorCoeGuard } from 'src/auth/guards/senior-coe.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

@Controller('exams/:examId/revaluation-window')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class RevaluationWindowsController {
  constructor(private readonly windowsService: RevaluationWindowsService) {}

  @Get()
  async get(@Param('examId', ParseIntPipe) examId: number) {
    const window = await this.windowsService.get(examId);
    return ApiResponse.ok(window, 'Revaluation window fetched successfully.');
  }

  @Patch()
  async update(
    @Param('examId', ParseIntPipe) examId: number,
    @Body() dto: UpdateRevaluationWindowDto,
  ) {
    const window = await this.windowsService.update(examId, dto);
    return ApiResponse.ok(window, 'Revaluation window updated successfully.');
  }

  @Patch('toggle')
  @UseGuards(JwtAuthGuard, RolesGuard, SeniorCoeGuard)
  async toggle(@Param('examId', ParseIntPipe) examId: number) {
    const window = await this.windowsService.toggle(examId);
    return ApiResponse.ok(window, 'Revaluation window toggled successfully.');
  }
}
