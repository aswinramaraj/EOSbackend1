import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { MarksEntryLocksService } from './marks-entry-locks.service';
import { QueryMarksEntryLockDto } from './dto/query-marks-entry-lock.dto';
import { UpdateMarksEntryLockDto } from './dto/update-marks-entry-lock.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SeniorCoeGuard } from 'src/auth/guards/senior-coe.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';

/**
 * Gates marks entry for one exam+department combo, separate from
 * result_publications (that's the exam-wide "final results are out" flag).
 * Faculty writes in src/modules/faculty/exam-marks check is_locked here.
 */
@Controller('marks-entry-locks')
export class MarksEntryLocksController {
  constructor(private readonly marksEntryLocksService: MarksEntryLocksService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async find(@Query() query: QueryMarksEntryLockDto) {
    const lock = await this.marksEntryLocksService.find(query);
    return ApiResponse.ok(lock, 'Marks entry lock fetched successfully.');
  }

  @Patch()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async setLock(
    @Query() query: QueryMarksEntryLockDto,
    @Body() dto: UpdateMarksEntryLockDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const lock = await this.marksEntryLocksService.setLock(query, dto, user.sub);
    return ApiResponse.ok(lock, 'Marks entry lock updated successfully.');
  }

  @Patch('publish')
  @UseGuards(JwtAuthGuard, RolesGuard, SeniorCoeGuard)
  @Roles(ROLES.COE)
  async publish(
    @Query() query: QueryMarksEntryLockDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const lock = await this.marksEntryLocksService.publish(query, user.sub);
    return ApiResponse.ok(lock, 'Marks entry published successfully.');
  }
}
