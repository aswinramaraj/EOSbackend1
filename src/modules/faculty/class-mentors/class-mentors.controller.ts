import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { ClassMentorsService } from './class-mentors.service';

/**
 * Faculty self-service mentee views — gated by class_mentors, not by the
 * teaching mapping used elsewhere. Lives in its own module since no
 * existing module owns the class_mentors self-service surface.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClassMentorsController {
  constructor(private readonly classMentorsService: ClassMentorsService) {}

  /**
   * GET /api/v1/me/mentee-classes — Faculty or HoD. An HoD who also
   * mentors a class gets the same real list; one who doesn't just gets an
   * empty array (see getMenteeClasses — resolveFacultyByUserId still works
   * for an HoD's own faculty row), never a hard 403.
   */
  @Get('mentee-classes')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteeClasses(@CurrentUser() user: JwtPayload) {
    return this.classMentorsService.getMenteeClasses(user.sub);
  }

  /**
   * GET /api/v1/me/mentee-classes/:class_id/students — Faculty or HoD
   * (mentor of this class). Powers the "Class Result" screen: full roster
   * with attendance %, CGPA/arrears (both derived from exam_marks — see
   * getMenteeClassResult's doc comment), mentor, guardian, contact.
   */
  @Get('mentee-classes/:class_id/students')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteeClassResult(
    @Param('class_id', ParseIntPipe) classId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getMenteeClassResult(classId, user.sub);
  }

  /** GET /api/v1/me/mentees/:student_id/profile — Faculty only (the mentee's class mentor). */
  @Get('mentees/:student_id/profile')
  @Roles(ROLES.FACULTY)
  getMenteeProfile(
    @Param('student_id', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getMenteeProfile(studentId, user.sub);
  }

  /**
   * GET /api/v1/me/mentees/:student_id/report — Faculty only (the mentee's
   * class mentor). Sensitive — includes Aadhar/PAN, deliberately separate
   * from /profile.
   */
  @Get('mentees/:student_id/report')
  @Roles(ROLES.FACULTY)
  getMenteeReport(
    @Param('student_id', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getMenteeReport(studentId, user.sub);
  }

  /** GET /api/v1/me/mentees/:student_id/placements — Faculty only (the mentee's class mentor). */
  @Get('mentees/:student_id/placements')
  @Roles(ROLES.FACULTY)
  getMenteePlacements(
    @Param('student_id', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getMenteePlacements(studentId, user.sub);
  }

  /** GET /api/v1/me/children/:student_id/mentor — Parent only. */
  @Get('children/:student_id/mentor')
  @Roles(ROLES.PARENT)
  getChildMentor(
    @Param('student_id', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getChildMentor(studentId, user.sub);
  }
}
