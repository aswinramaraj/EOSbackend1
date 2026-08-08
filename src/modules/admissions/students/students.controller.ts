import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { StudentsService } from './students.service';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { AdminUpdateStudentDto } from './dto/admin-update-student.dto';
import { AdminAttendanceSummaryQueryDto } from './dto/admin-attendance-summary-query.dto';

/**
 * No POST here — creation stays exclusively through
 * soa-applications/:id/perfect-entry, which already handles the linked user
 * account, duplicate checks and conditional business rules correctly.
 */
@Controller('students')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  findAll(@Query() query: ListStudentsQueryDto) {
    return this.studentsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.findOne(id);
  }

  @Get(':id/attendance-summary')
  getAttendanceSummary(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminAttendanceSummaryQueryDto,
  ) {
    return this.studentsService.getAttendanceSummary(id, query);
  }

  @Get(':id/attendance-by-semester')
  getAttendanceBySemester(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getAttendanceBySemester(id);
  }

  @Get(':id/profile-details')
  getProfileDetails(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getProfileDetails(id);
  }

  @Get(':id/family')
  getFamily(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getFamily(id);
  }

  @Get(':id/lifecycle')
  getLifecycle(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getLifecycle(id);
  }

  @Get(':id/subjects')
  getSubjects(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getSubjects(id);
  }

  @Get(':id/requests')
  getRequests(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getRequests(id);
  }

  @Get(':id/announcements')
  getAnnouncements(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getAnnouncements(id);
  }

  @Get(':id/certificates')
  getCertificates(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getCertificates(id);
  }

  @Get(':id/transport')
  getTransport(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getTransport(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: AdminUpdateStudentDto) {
    return this.studentsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.remove(id);
  }
}
