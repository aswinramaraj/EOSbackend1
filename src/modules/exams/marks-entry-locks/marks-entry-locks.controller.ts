import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { MarksEntryLocksService } from './marks-entry-locks.service';
import { FindMarksEntryLocksQueryDto } from './dto/find-marks-entry-locks-query.dto';
import { SetMarksEntryLockDto } from './dto/set-marks-entry-lock.dto';

/**
 * New controller over `marks_entry_locks` — the table already existed but
 * nothing read or wrote it. COE-only, matches the design's "Lock marks
 * entry" action; no schema change.
 */
@Controller('marks-entry-locks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class MarksEntryLocksController {
  constructor(private readonly marksEntryLocksService: MarksEntryLocksService) {}

  @Get()
  async findAll(@Query() query: FindMarksEntryLocksQueryDto) {
    const locks = await this.marksEntryLocksService.findAll(query);
    return ApiResponse.ok(locks, 'Marks entry locks fetched successfully.');
  }

  @Post()
  async setLock(@Body() dto: SetMarksEntryLockDto, @CurrentUser() user: JwtPayload) {
    const lock = await this.marksEntryLocksService.setLock(dto, user.sub);
    return ApiResponse.ok(lock, 'Marks entry lock updated successfully.');
  }
}
