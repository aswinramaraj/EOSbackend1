import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodStudentProfileService } from './hod-student-profile.service';
import { CreateMeetingNoteDto } from './dto/create-meeting-note.dto';

/**
 * Same base path as hod-class-records — this is the detail page reached by
 * clicking a Class Records row, kept as its own module for size, not its
 * own route prefix.
 */
@Controller('hod/class-records')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodStudentProfileController {
  constructor(
    private readonly hodStudentProfileService: HodStudentProfileService,
  ) {}

  /** GET /api/v1/hod/class-records/student/:id */
  @Get('student/:id')
  getProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.hodStudentProfileService.getProfile(user.sub, id);
  }

  /** GET /api/v1/hod/class-records/student/:id/meeting-notes */
  @Get('student/:id/meeting-notes')
  getMeetingNotes(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.hodStudentProfileService.getMeetingNotes(user.sub, id);
  }

  /** POST /api/v1/hod/class-records/student/:id/meeting-notes */
  @Post('student/:id/meeting-notes')
  addMeetingNote(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateMeetingNoteDto,
  ) {
    return this.hodStudentProfileService.addMeetingNote(
      user.sub,
      id,
      dto.meeting_date,
      dto.note,
    );
  }
}
