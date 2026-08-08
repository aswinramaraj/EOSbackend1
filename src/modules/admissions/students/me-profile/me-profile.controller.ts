import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GetAttendanceDto } from './dto/get-attendance.dto';
import { GetExamResultsDto } from './dto/get-exam-results.dto';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { GetLeavesDto } from './dto/get-leaves.dto';
import { CreateOdTeamDto } from './dto/create-od-team.dto';
import { JoinOdTeamDto } from './dto/join-od-team.dto';
import { CreateOdRequestDto } from './dto/create-od-request.dto';
import { GetOdRequestsDto } from './dto/get-od-requests.dto';
import { CreateHostelOutingDto } from './dto/create-hostel-outing.dto';
import { GetHostelOutingsDto } from './dto/get-hostel-outings.dto';
import { CreateBonafideRequestDto } from './dto/create-bonafide-request.dto';
import { GetBonafideRequestsDto } from './dto/get-bonafide-requests.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { GetProjectsDto } from './dto/get-projects.dto';
import { MeProfileService } from './me-profile.service';
import { MeAttendanceService } from './me-attendance.service';
import { MeExamResultsService } from './me-exam-results.service';
import { MeLeavesService } from './me-leaves.service';
import { MeLeavesListService } from './me-leaves-list.service';
import { MeOdTeamsService } from './me-od-teams.service';
import { MeOdTeamsListService } from './me-od-teams-list.service';
import { MeOdRequestsService } from './me-od-requests.service';
import { MeOdRequestsListService } from './me-od-requests-list.service';
import { MeHostelOutingsService } from './me-hostel-outings.service';
import { MeBonafideRequestsService } from './me-bonafide-requests.service';
import { MeProjectsService } from './me-projects.service';
import { MeFacultyDirectoryService } from './me-faculty-directory.service';
import { MeFeesService } from './me-fees.service';
import { MeExamScheduleService } from './me-exam-schedule.service';
import { MeHostelRoomService } from './me-hostel-room.service';
import { MeHostelComplaintsService } from './me-hostel-complaints.service';
import { MeMessFeedbackService } from './me-mess-feedback.service';
import { MeAcademicCalendarService } from './me-academic-calendar.service';
import { CreateMyHostelComplaintDto } from './dto/create-my-hostel-complaint.dto';
import { CreateMyMessFeedbackDto } from './dto/create-my-mess-feedback.dto';

@Controller('me')
export class MeController {
  constructor(
    private readonly meProfileService: MeProfileService,
    private readonly meAttendanceService: MeAttendanceService,
    private readonly meExamResultsService: MeExamResultsService,
    private readonly meLeavesService: MeLeavesService,
    private readonly meLeavesListService: MeLeavesListService,
    private readonly meOdTeamsService: MeOdTeamsService,
    private readonly meOdTeamsListService: MeOdTeamsListService,
    private readonly meOdRequestsService: MeOdRequestsService,
    private readonly meOdRequestsListService: MeOdRequestsListService,
    private readonly meHostelOutingsService: MeHostelOutingsService,
    private readonly meBonafideRequestsService: MeBonafideRequestsService,
    private readonly meProjectsService: MeProjectsService,
    private readonly meFacultyDirectoryService: MeFacultyDirectoryService,
    private readonly meFeesService: MeFeesService,
    private readonly meExamScheduleService: MeExamScheduleService,
    private readonly meHostelRoomService: MeHostelRoomService,
    private readonly meHostelComplaintsService: MeHostelComplaintsService,
    private readonly meMessFeedbackService: MeMessFeedbackService,
    private readonly meAcademicCalendarService: MeAcademicCalendarService,
  ) {}

  /**
   * PUT /api/v1/me/profile
   *
   * Self-scoped: student_id is always resolved from the JWT, never accepted
   * from the request. Partial-update semantics despite the PUT verb (see
   * todo.md/PUT-me-profile.md "Known Limitations" — PATCH would be more
   * accurate, kept as PUT to match the agreed contract).
   *
   * Error responses:
   *  400 VALIDATION_ERROR      – malformed field (bad email/mobile format, etc.)
   *  401 UNAUTHORIZED          – missing/invalid JWT
   *  403 FORBIDDEN             – authenticated but not a student
   *  404 STUDENT_NOT_FOUND     – authenticated user has no linked student record
   *  422 INVALID_ADDRESS_TYPE  – addresses[].address_type isn't a real enum value
   *  500 INTERNAL_ERROR        – unexpected server failure
   */
  @Put('profile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.meProfileService.updateMyProfile(user.sub, dto);
  }

  /**
   * GET /api/v1/me/profile
   *
   * Self-scoped: student_id is always resolved from the JWT. Returns the
   * core student record joined to courses/quotas/classes/batches display
   * names plus addresses/identity_marks/family_details/contacts.
   * `student_sensitive_info` (Aadhar/PAN) is intentionally never returned —
   * see todo.md/5-GET-me-profile.md's own note about a future, separately
   * scoped sensitive-info endpoint.
   *
   * Error responses:
   *  401 UNAUTHORIZED       – missing/invalid JWT
   *  403 FORBIDDEN          – authenticated but not a student
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *  500 INTERNAL_ERROR     – unexpected server failure
   */
  @Get('profile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.meProfileService.getMyProfile(user.sub);
  }

  /**
   * GET /api/v1/me/attendance?from=&to=&subject_id=
   *
   * Self-scoped: student_id resolved from the JWT. Aggregates
   * `attendance_records` in [from, to] into an overall summary, a
   * per-subject breakdown, and the raw day-by-day list.
   *
   * Error responses:
   *  400 VALIDATION_ERROR   – missing/malformed from/to, or from > to
   *  401 UNAUTHORIZED       – missing/invalid JWT
   *  403 FORBIDDEN          – authenticated but not a student
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *  404 SUBJECT_NOT_FOUND  – subject_id doesn't reference an existing subject
   *  500 INTERNAL_ERROR     – unexpected server failure
   */
  @Get('attendance')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getAttendance(
    @CurrentUser() user: JwtPayload,
    @Query() dto: GetAttendanceDto,
  ) {
    return this.meAttendanceService.getMyAttendance(user.sub, dto);
  }

  /**
   * GET /api/v1/me/exam-results?semester=
   *
   * Self-scoped: student_id resolved from the JWT. Groups the caller's own
   * exam_marks for the requested semester into "internals" (Internal
   * Assessment/Model Examination) and a single "semester_exam" (End
   * Semester Examination), each with a subject-wise breakdown - see
   * MeExamResultsService for the visible-statuses/semester-exam-type
   * classification rationale.
   *
   * Error responses:
   *  400 VALIDATION_ERROR   – semester missing/out of range
   *  401 UNAUTHORIZED       – missing/invalid JWT
   *  403 FORBIDDEN          – authenticated but not a student
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *  500 INTERNAL_ERROR     – unexpected server failure
   */
  @Get('exam-results')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getExamResults(
    @CurrentUser() user: JwtPayload,
    @Query() dto: GetExamResultsDto,
  ) {
    return this.meExamResultsService.getMyExamResults(user.sub, dto);
  }

  /**
   * POST /api/v1/me/leaves
   *
   * Self-scoped: student_id resolved from the JWT. Always starts the
   * two-stage approval chain at status='pending', both approval columns
   * null. Does not check for an assigned mentor or overlapping requests —
   * both explicitly out of scope per todo.md/7-POST-me-leaves.md.
   *
   * Error responses:
   *  400 VALIDATION_ERROR    – missing/malformed from_date/to_date
   *  401 UNAUTHORIZED        – missing/invalid JWT
   *  403 FORBIDDEN           – authenticated but not a student
   *  404 STUDENT_NOT_FOUND   – authenticated user has no linked student record
   *  422 INVALID_DATE_RANGE  – from_date in the past, or from_date > to_date
   *  500 INTERNAL_ERROR      – unexpected server failure
   */
  @Post('leaves')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  createLeave(@CurrentUser() user: JwtPayload, @Body() dto: CreateLeaveDto) {
    return this.meLeavesService.createLeave(user.sub, dto);
  }

  /**
   * GET /api/v1/me/leaves?status=&page=&page_size=
   *
   * Self-scoped: student_id resolved from the JWT. Lists the caller's own
   * leave requests, most-recent-first, with resolved approver display
   * strings for the mentor-faculty and HoD stages.
   *
   * Error responses:
   *  400 VALIDATION_ERROR   – status isn't a real enum value
   *  401 UNAUTHORIZED       – missing/invalid JWT
   *  403 FORBIDDEN          – authenticated but not a student
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *  500 INTERNAL_ERROR     – unexpected server failure
   */
  @Get('leaves')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getLeaves(@CurrentUser() user: JwtPayload, @Query() dto: GetLeavesDto) {
    return this.meLeavesListService.getMyLeaves(user.sub, dto);
  }

  /**
   * GET /api/v1/me/faculty-directory
   *
   * A minimal, student-safe faculty picker (name + department only) -
   * backs the OD apply form's "Faculty guide" dropdown. See
   * MeFacultyDirectoryService for why this is a separate endpoint from
   * GET /faculty (which is Admin/HoD-only and returns HR-sensitive
   * fields this one deliberately omits).
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid JWT
   *  403 FORBIDDEN       – authenticated but not a student
   *  500 INTERNAL_ERROR  – unexpected server failure
   */
  @Get('faculty-directory')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getFacultyDirectory() {
    return this.meFacultyDirectoryService.getFacultyDirectory();
  }

  /**
   * GET /api/v1/me/od-teams
   *
   * Self-scoped: lists every OD team the caller belongs to (creator or
   * plain member), most-recently-created first. See MeOdTeamsListService
   * for why `has_request`/`od_request_id` are included (lets the Apply tab
   * tell "still gathering members" apart from "already submitted" without
   * a second round trip).
   *
   * Error responses:
   *  401 UNAUTHORIZED       – missing/invalid JWT
   *  403 FORBIDDEN          – authenticated but not a student
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *  500 INTERNAL_ERROR     – unexpected server failure
   */
  @Get('od-teams')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getOdTeams(@CurrentUser() user: JwtPayload) {
    return this.meOdTeamsListService.getMyOdTeams(user.sub);
  }

  /**
   * POST /api/v1/me/od-teams
   *
   * Self-scoped: created_by_student_id resolved from the JWT. Auto-joins
   * the creator as the team's first od_team_members row (see
   * MeOdTeamsService for the rationale) and generates a collision-checked
   * unique_code server-side. Request body is empty per
   * todo.md/9-POST-me-od-teams.md — CreateOdTeamDto has no properties so
   * the global whitelist rejects any attempt to inject
   * created_by_student_id/unique_code/is_locked.
   *
   * Error responses:
   *  401 UNAUTHORIZED       – missing/invalid JWT
   *  403 FORBIDDEN          – authenticated but not a student
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *  500 INTERNAL_ERROR     – unexpected server failure
   */
  @Post('od-teams')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  createOdTeam(
    @CurrentUser() user: JwtPayload,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- CreateOdTeamDto has no properties; binding it here is what makes the global whitelist/forbidNonWhitelisted pipe reject any smuggled created_by_student_id/unique_code/is_locked in the body
    @Body() dto: CreateOdTeamDto,
  ) {
    return this.meOdTeamsService.createOdTeam(user.sub);
  }

  /**
   * POST /api/v1/me/od-teams/join
   *
   * Self-scoped: student_id resolved from the JWT. Resolves the target team
   * from the client-supplied unique_code — the only field the client
   * controls. See MeOdTeamsService.joinOdTeam() for the already-member race
   * handling and the response-enrichment rationale.
   *
   * Error responses:
   *  400 VALIDATION_ERROR   – unique_code missing/empty
   *  401 UNAUTHORIZED       – missing/invalid JWT
   *  403 FORBIDDEN          – authenticated but not a student
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *  404 TEAM_NOT_FOUND     – unique_code doesn't match any team
   *  409 ALREADY_A_MEMBER   – student already belongs to this team
   *  422 TEAM_LOCKED        – team is no longer accepting new members
   *  500 INTERNAL_ERROR     – unexpected server failure
   */
  @Post('od-teams/join')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  joinOdTeam(@CurrentUser() user: JwtPayload, @Body() dto: JoinOdTeamDto) {
    return this.meOdTeamsService.joinOdTeam(user.sub, dto);
  }

  /**
   * DELETE /api/v1/me/od-teams/:id/members/:student_id
   *
   * Authorization is narrower than the usual "any student" gate: resolved
   * inside MeOdTeamsService as "caller is the team's creator, or caller is
   * the targeted student themselves" — never trusted from the request.
   * Deliberately has no is_locked check (allowed even after lock, per the
   * spec's own explicit asymmetry with joining).
   *
   * Error responses:
   *  401 UNAUTHORIZED             – missing/invalid JWT
   *  403 FORBIDDEN                – authenticated but not a student
   *  403 NOT_AUTHORIZED_TO_REMOVE – caller is neither creator nor target
   *  404 STUDENT_NOT_FOUND        – authenticated user has no linked student record
   *  404 TEAM_NOT_FOUND           – id doesn't match any team
   *  404 MEMBER_NOT_FOUND         – target student isn't a member of this team
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Delete('od-teams/:id/members/:student_id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  removeOdTeamMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) teamId: number,
    @Param('student_id', ParseIntPipe) studentId: number,
  ) {
    return this.meOdTeamsService.removeOdTeamMember(
      user.sub,
      teamId,
      studentId,
    );
  }

  /**
   * POST /api/v1/me/od-teams/:id/requests
   *
   * Creator-only: locks the team and fans out one od_request_hod_approvals
   * row per member in a single transaction. See
   * MeOdTeamsService.submitOdRequest() for the dedup rule (resolved from
   * the schema's own unique constraint), the minimum-team-size decision,
   * and the response-enrichment rationale.
   *
   * Error responses:
   *  400 VALIDATION_ERROR          – missing/malformed from_date/to_date
   *  401 UNAUTHORIZED              – missing/invalid JWT
   *  403 FORBIDDEN                 – authenticated but not a student
   *  403 NOT_TEAM_CREATOR          – caller isn't this team's creator
   *  404 STUDENT_NOT_FOUND         – authenticated user has no linked student record
   *  404 TEAM_NOT_FOUND            – id doesn't match any team
   *  404 FACULTY_NOT_FOUND         – faculty_guide_id doesn't match any faculty row
   *  409 REQUEST_ALREADY_SUBMITTED – team is already locked
   *  422 INVALID_DATE_RANGE        – from_date in the past, or from_date > to_date
   *  422 MEMBER_MISSING_DEPARTMENT – a team member has no resolvable department
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Post('od-teams/:id/requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  submitOdRequest(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) teamId: number,
    @Body() dto: CreateOdRequestDto,
  ) {
    return this.meOdTeamsService.submitOdRequest(user.sub, teamId, dto);
  }

  /**
   * GET /api/v1/me/od-requests?page=&page_size=
   *
   * Self-scoped: lists every od_request for a team the caller is (or was)
   * a member of, most-recent-first — the History tab's data source. See
   * MeOdRequestsListService for why this stays lighter than the
   * per-request GET (approval counts, not every teammate's name).
   *
   * Error responses:
   *  400 VALIDATION_ERROR   – page/page_size out of range
   *  401 UNAUTHORIZED       – missing/invalid JWT
   *  403 FORBIDDEN          – authenticated but not a student
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *  500 INTERNAL_ERROR     – unexpected server failure
   */
  @Get('od-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getOdRequests(
    @CurrentUser() user: JwtPayload,
    @Query() dto: GetOdRequestsDto,
  ) {
    return this.meOdRequestsListService.getMyOdRequests(user.sub, dto);
  }

  /**
   * GET /api/v1/me/od-requests/:id
   *
   * Authorization: any member of the request's team (not creator-only) —
   * resolved from the JWT. See MeOdRequestsService.getOdRequestStatus() for
   * the name-resolution fallback chain, the department_name enrichment,
   * and the overall_status precedence decision.
   *
   * Error responses:
   *  400 VALIDATION_ERROR    – id isn't an integer
   *  401 UNAUTHORIZED        – missing/invalid JWT
   *  403 FORBIDDEN           – authenticated but not a student
   *  403 NOT_A_TEAM_MEMBER   – caller isn't on the request's team
   *  404 STUDENT_NOT_FOUND   – authenticated user has no linked student record
   *  404 OD_REQUEST_NOT_FOUND – id doesn't match any od_requests row
   *  500 INTERNAL_ERROR      – unexpected server failure
   */
  @Get('od-requests/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getOdRequest(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.meOdRequestsService.getOdRequestStatus(user.sub, id);
  }

  /**
   * POST /api/v1/me/hostel-outings
   *
   * Self-scoped: student_id resolved from the JWT. See
   * MeHostelOutingsService.createHostelOuting() for why the hosteller
   * check is implemented (not left pending) and the room_number
   * enrichment rationale.
   *
   * Error responses:
   *  400 VALIDATION_ERROR   – missing/malformed from_date/to_date/start_time
   *  401 UNAUTHORIZED       – missing/invalid JWT
   *  403 FORBIDDEN          – authenticated but not a student
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *  422 INVALID_DATE_RANGE – from_date in the past, or from_date > to_date
   *  422 NOT_A_HOSTELLER    – caller has no student_hostel_mapping row
   *  500 INTERNAL_ERROR     – unexpected server failure
   */
  @Post('hostel-outings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  createHostelOuting(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateHostelOutingDto,
  ) {
    return this.meHostelOutingsService.createHostelOuting(user.sub, dto);
  }

  /**
   * GET /api/v1/me/hostel-outings?status=&page=&page_size=
   *
   * Self-scoped: student_id resolved from the JWT. Unlike the POST
   * sibling, does NOT gate on hosteller status — see
   * MeHostelOutingsService.getMyHostelOutings() for the rationale and the
   * approved_by_warden/room_number resolution details.
   *
   * Error responses:
   *  400 VALIDATION_ERROR   – status isn't a real enum value
   *  401 UNAUTHORIZED       – missing/invalid JWT
   *  403 FORBIDDEN          – authenticated but not a student
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *  500 INTERNAL_ERROR     – unexpected server failure
   */
  @Get('hostel-outings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getHostelOutings(
    @CurrentUser() user: JwtPayload,
    @Query() dto: GetHostelOutingsDto,
  ) {
    return this.meHostelOutingsService.getMyHostelOutings(user.sub, dto);
  }

  /**
   * POST /api/v1/me/bonafide-requests
   *
   * Self-scoped: student_id resolved from the JWT. See
   * MeBonafideRequestsService.createBonafideRequest() for why the
   * duplicate-pending-request check (spec §5's soft 429) is deliberately
   * NOT implemented, and the reason_text enrichment rationale.
   *
   * Error responses:
   *  400 VALIDATION_ERROR  – reason_id missing or not a positive integer
   *  401 UNAUTHORIZED      – missing/invalid JWT
   *  403 FORBIDDEN         – authenticated but not a student
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  404 REASON_NOT_FOUND  – reason_id doesn't reference an existing
   *                          bonafide_reasons row
   *  500 INTERNAL_ERROR    – unexpected server failure
   */
  @Post('bonafide-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  createBonafideRequest(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateBonafideRequestDto,
  ) {
    return this.meBonafideRequestsService.createBonafideRequest(user.sub, dto);
  }

  /**
   * GET /api/v1/me/bonafide-requests?status=&page=&page_size=
   *
   * Self-scoped: student_id resolved from the JWT. No gating rule to
   * consider on the read side — see
   * MeBonafideRequestsService.getMyBonafideRequests() for the
   * reason_text join rationale.
   *
   * Error responses:
   *  400 VALIDATION_ERROR  – status isn't a real enum value
   *  401 UNAUTHORIZED      – missing/invalid JWT
   *  403 FORBIDDEN         – authenticated but not a student
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  500 INTERNAL_ERROR    – unexpected server failure
   */
  @Get('bonafide-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getBonafideRequests(
    @CurrentUser() user: JwtPayload,
    @Query() dto: GetBonafideRequestsDto,
  ) {
    return this.meBonafideRequestsService.getMyBonafideRequests(user.sub, dto);
  }

  /**
   * POST /api/v1/me/projects
   *
   * Self-scoped: student_id resolved from the JWT. See
   * MeProjectsService.createProject() for the mentor_faculty_name
   * enrichment rationale.
   *
   * Error responses:
   *  400 VALIDATION_ERROR  – title missing/empty, or mentor_faculty_id not
   *                          a positive integer
   *  401 UNAUTHORIZED      – missing/invalid JWT
   *  403 FORBIDDEN         – authenticated but not a student
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  404 FACULTY_NOT_FOUND – mentor_faculty_id doesn't reference an
   *                          existing faculty row
   *  500 INTERNAL_ERROR    – unexpected server failure
   */
  @Post('projects')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  createProject(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProjectDto,
  ) {
    return this.meProjectsService.createProject(user.sub, dto);
  }

  /**
   * GET /api/v1/me/projects?page=&page_size=
   *
   * Self-scoped: student_id resolved from the JWT. No status filter (no
   * such column exists on student_projects) — see
   * todo.md/19-GET-me-projects.md (self-authored) and
   * MeProjectsService.getMyProjects() for the id-DESC ordering rationale
   * (student_projects has no created_at column).
   *
   * Error responses:
   *  401 UNAUTHORIZED      – missing/invalid JWT
   *  403 FORBIDDEN         – authenticated but not a student
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  500 INTERNAL_ERROR    – unexpected server failure
   */
  @Get('projects')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getProjects(@CurrentUser() user: JwtPayload, @Query() dto: GetProjectsDto) {
    return this.meProjectsService.getMyProjects(user.sub, dto);
  }

  /**
   * GET /api/v1/me/fees
   *
   * Self-scoped: student_id resolved from the JWT. Returns every
   * student_fee_demand_mapping row for the caller (one per demanded fee
   * structure, e.g. per semester) with paid/due/status computed from their
   * fee_payments rows, plus a flat payment history list for receipts.
   *
   * Error responses:
   *  401 UNAUTHORIZED      – missing/invalid JWT
   *  403 FORBIDDEN         – authenticated but not a student
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  500 INTERNAL_ERROR    – unexpected server failure
   */
  @Get('fees')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getFees(@CurrentUser() user: JwtPayload) {
    return this.meFeesService.getMyFees(user.sub);
  }

  /**
   * GET /api/v1/me/exam-schedule
   *
   * Self-scoped: class_id resolved from the JWT's linked student record.
   * Returns every published exam_timetable row for the caller's own class,
   * composed with subject/exam-type display names (the public exam-* list
   * endpoints only return raw FK ids).
   *
   * Error responses:
   *  401 UNAUTHORIZED      – missing/invalid JWT
   *  403 FORBIDDEN         – authenticated but not a student
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  500 INTERNAL_ERROR    – unexpected server failure
   */
  @Get('exam-schedule')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getExamSchedule(@CurrentUser() user: JwtPayload) {
    return this.meExamScheduleService.getMyExamSchedule(user.sub);
  }

  /**
   * GET /api/v1/me/hostel-room
   *
   * Self-scoped: student_id resolved from the JWT. `is_hostel_resident:
   * false` (all room fields null) is a normal response for a day scholar,
   * not an error.
   *
   * Error responses:
   *  401 UNAUTHORIZED      – missing/invalid JWT
   *  403 FORBIDDEN         – authenticated but not a student
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  500 INTERNAL_ERROR    – unexpected server failure
   */
  @Get('hostel-room')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getHostelRoom(@CurrentUser() user: JwtPayload) {
    return this.meHostelRoomService.getMyHostelRoom(user.sub);
  }

  /**
   * POST /api/v1/me/hostel-complaints
   *
   * Self-scoped: student_id/hostel_id resolved from the JWT's linked
   * student_hostel_mapping, never accepted from the request.
   *
   * Error responses:
   *  401 UNAUTHORIZED      – missing/invalid JWT
   *  403 FORBIDDEN         – authenticated but not a student
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  422 NOT_A_HOSTELLER   – caller has no student_hostel_mapping row
   *  500 INTERNAL_ERROR    – unexpected server failure
   */
  @Post('hostel-complaints')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  createHostelComplaint(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMyHostelComplaintDto,
  ) {
    return this.meHostelComplaintsService.createComplaint(user.sub, dto);
  }

  /**
   * POST /api/v1/me/mess-feedback
   *
   * Self-scoped: student_id/hostel_id resolved from the JWT's linked
   * student_hostel_mapping, never accepted from the request.
   *
   * Error responses:
   *  401 UNAUTHORIZED      – missing/invalid JWT
   *  403 FORBIDDEN         – authenticated but not a student
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  422 NOT_A_HOSTELLER   – caller has no student_hostel_mapping row
   *  500 INTERNAL_ERROR    – unexpected server failure
   */
  @Post('mess-feedback')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  createMessFeedback(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMyMessFeedbackDto,
  ) {
    return this.meMessFeedbackService.createFeedback(user.sub, dto);
  }

  /**
   * GET /api/v1/me/academic-calendar
   *
   * Self-scoped: class_id resolved from the JWT's linked student record,
   * then class_id -> classes.batch_id/current_semester -> the matching
   * academic_calendars row and its calendar_events. A student with no class
   * assigned, or whose batch/semester has no calendar published yet, gets
   * an honest empty response (semester/dates null, events []), not an error.
   *
   * Error responses:
   *  401 UNAUTHORIZED      – missing/invalid JWT
   *  403 FORBIDDEN         – authenticated but not a student
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  500 INTERNAL_ERROR    – unexpected server failure
   */
  @Get('academic-calendar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  getAcademicCalendar(@CurrentUser() user: JwtPayload) {
    return this.meAcademicCalendarService.getMyAcademicCalendar(user.sub);
  }
}
