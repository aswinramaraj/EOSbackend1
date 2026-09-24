import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
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
   *
   * Optional `?scope=today` narrows attendance_percent to just today's
   * marked periods (used by the Dashboard's Today/This term toggle); any
   * other value, or omitting it, keeps the original all-time computation
   * every other caller of this endpoint already relies on.
   */
  @Get('mentee-classes/:class_id/students')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteeClassResult(
    @Param('class_id', ParseIntPipe) classId: number,
    @Query('scope') scope: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getMenteeClassResult(
      classId,
      user.sub,
      scope === 'today',
    );
  }

  /**
   * GET /api/v1/me/mentees/:student_id/profile — Faculty/HoD (the mentee's
   * class mentor). HOD included so an HoD who also mentors a class (Switch
   * Account's "Class Advisor" mode) gets the same mentee drill-down as any
   * other mentor, same precedent as getMenteeClasses/getMenteeClassResult
   * above.
   */
  @Get('mentees/:student_id/profile')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteeProfile(
    @Param('student_id', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getMenteeProfile(studentId, user.sub);
  }

  /**
   * GET /api/v1/me/mentees/:student_id/report — Faculty or HoD (the
   * mentee's class mentor). Sensitive — includes Aadhar/PAN, deliberately
   * separate from /profile.
   */
  @Get('mentees/:student_id/report')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteeReport(
    @Param('student_id', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getMenteeReport(studentId, user.sub);
  }

  /**
   * GET /api/v1/me/mentees/:student_id/documents — Faculty or HoD (the
   * mentee's class mentor). Real `student_certificates` rows (admin-set
   * is_available/file_url/verified_at, one per certificate_types entry) —
   * this table existed in the schema with zero endpoints anywhere reading
   * it before this; same mentor-scoped auth pattern as /profile and /report.
   */
  @Get('mentees/:student_id/documents')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteeDocuments(
    @Param('student_id', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getMenteeDocuments(studentId, user.sub);
  }

  /** GET /api/v1/me/mentees/:student_id/placements — Faculty or HoD (the mentee's class mentor). */
  @Get('mentees/:student_id/placements')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteePlacements(
    @Param('student_id', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getMenteePlacements(studentId, user.sub);
  }

  /**
   * GET /api/v1/me/mentees/:student_id/academic-record — Faculty or HoD
   * (the mentee's class mentor). Semester-wise GPA, monthly attendance and
   * per-subject internal/end-sem/grade/attendance — see
   * getMenteeAcademicRecord's doc comment for exactly what is and isn't
   * derived here.
   */
  @Get('mentees/:student_id/academic-record')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteeAcademicRecord(
    @Param('student_id', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getMenteeAcademicRecord(
      studentId,
      user.sub,
    );
  }

  /**
   * GET /api/v1/me/mentee-classes/:class_id/subject-records — Faculty or HoD
   * (mentor of this class). Every exam_subject_mapping row for the class —
   * every subject, every exam — not just ones the caller personally teaches;
   * see ClassMentorsService.findAllForClassMentor's doc comment.
   */
  @Get('mentee-classes/:class_id/subject-records')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteeClassSubjectRecords(
    @Param('class_id', ParseIntPipe) classId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.findAllForClassMentor(classId, user.sub);
  }

  /**
   * GET /api/v1/me/mentee-classes/:class_id/no-due — Faculty or HoD (mentor
   * of this class). Class-mentor-scoped sibling of GET /hod/no-due — same
   * live fee/library/academics dues computation, scoped to one mentored
   * class instead of a whole department.
   */
  @Get('mentee-classes/:class_id/no-due')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteeClassNoDue(
    @Param('class_id', ParseIntPipe) classId: number,
    @Query('search') search: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.getNoDueForClassMentor(
      classId,
      user.sub,
      search,
    );
  }

  /**
   * PATCH /api/v1/me/mentee-classes/:class_id/no-due/:student_id — Faculty
   * or HoD (mentor of this class). Only `{ issue: true }` does anything real
   * (approves the no-due override) — see ClassMentorsService.
   * patchNoDueForClassMentor's doc comment.
   */
  @Patch('mentee-classes/:class_id/no-due/:student_id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  patchMenteeClassNoDue(
    @Param('class_id', ParseIntPipe) classId: number,
    @Param('student_id', ParseIntPipe) studentId: number,
    @Body() body: { issue?: boolean },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.patchNoDueForClassMentor(
      classId,
      studentId,
      user.sub,
      body,
    );
  }

  /**
   * GET /api/v1/me/mentee-classes/:class_id/higher-education — Faculty or
   * HoD (mentor of this class). Which students in this mentee class have
   * registered a student_higher_education row — the Advisor's own view,
   * distinct from the generic student-facing opt-in screens.
   */
  @Get('mentee-classes/:class_id/higher-education')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteeClassHigherEducation(
    @Param('class_id', ParseIntPipe) classId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.findHigherEducationForClassMentor(
      classId,
      user.sub,
    );
  }

  /**
   * GET /api/v1/me/mentee-classes/:class_id/entrepreneurship — Faculty or
   * HoD (mentor of this class). Which students in this mentee class have
   * registered a student_entrepreneurship row — the Advisor's own view,
   * distinct from the generic EDC/Coordinator-facing screens.
   */
  @Get('mentee-classes/:class_id/entrepreneurship')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMenteeClassEntrepreneurship(
    @Param('class_id', ParseIntPipe) classId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classMentorsService.findEntrepreneurshipForClassMentor(
      classId,
      user.sub,
    );
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
