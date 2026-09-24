import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { CreateMyHostelComplaintDto } from 'src/modules/admissions/students/me-profile/dto/create-my-hostel-complaint.dto';
import { FacultyHostelComplaintsService } from './faculty-hostel-complaints.service';

/**
 * Self-service hostel complaints for hostel-resident faculty (see
 * FacultyHostelComplaintsService's own doc comment). HOD is included since
 * an HOD is backed by a real faculty row (same convention as every other
 * faculty-self-service controller in this codebase).
 *
 * Error responses:
 *  401 UNAUTHORIZED      - missing/invalid JWT
 *  403 FORBIDDEN          - authenticated but not faculty/hod
 *  404 FACULTY_NOT_FOUND  - authenticated user has no linked faculty record
 *  422 NOT_A_HOSTELLER    - caller has no faculty_hostel_mapping row
 *  500 INTERNAL_ERROR     - unexpected server failure
 */
@Controller('faculty/hostel-complaints')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY, ROLES.HOD)
export class FacultyHostelComplaintsController {
  constructor(private readonly facultyHostelComplaints: FacultyHostelComplaintsService) {}

  @Get()
  listMine(@CurrentUser() user: JwtPayload) {
    return this.facultyHostelComplaints.listMyComplaints(user.sub);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateMyHostelComplaintDto) {
    return this.facultyHostelComplaints.createComplaint(user.sub, dto);
  }
}
