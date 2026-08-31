import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { ExamTimetableVersionsService } from './exam-timetable-versions.service';
import { MoveToDraftDto } from './dto/move-to-draft.dto';

@Controller('exam-timetable-versions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ExamTimetableVersionsController {
  constructor(private readonly service: ExamTimetableVersionsService) {}

  @Get()
  async findAll(@Query('exam_id') examId?: string) {
    const versions = await this.service.findAll(
      examId ? Number(examId) : undefined,
    );
    return ApiResponse.ok(versions, 'Timetable versions fetched successfully.');
  }

  @Post('move-to-draft')
  async moveToDraft(
    @Body() dto: MoveToDraftDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const version = await this.service.moveToDraft(dto.exam_id, user.sub);
    return ApiResponse.ok(version, 'Timetable moved to drafts.');
  }

  @Post(':id/publish')
  async publish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    const version = await this.service.publish(id, user.sub);
    return ApiResponse.ok(version, 'Timetable version published.');
  }

  @Post(':id/withdraw')
  async withdraw(@Param('id', ParseIntPipe) id: number) {
    const version = await this.service.withdraw(id);
    return ApiResponse.ok(version, 'Timetable version withdrawn.');
  }

  @Get(':id/schedule')
  async getSchedule(@Param('id', ParseIntPipe) id: number) {
    const schedule = await this.service.getSchedule(id);
    return ApiResponse.ok(schedule, 'Version schedule fetched successfully.');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
  }
}
