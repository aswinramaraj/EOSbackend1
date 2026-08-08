import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { LmsService } from './lms.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { CreateLinkResourceDto } from './dto/create-link-resource.dto';
import { CreateFileResourceDto } from './dto/create-file-resource.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { GradeSubmissionDto } from './dto/grade-submission.dto';
import { CreateLessonSessionDto } from './dto/create-lesson-session.dto';
import { UpdateLessonSessionDto } from './dto/update-lesson-session.dto';

const MAX_RESOURCE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_SUBMISSION_BYTES = 10 * 1024 * 1024; // 10 MB

function requireFile(file?: Express.Multer.File): Express.Multer.File {
  if (!file) {
    throw new BadRequestException({
      message: 'No file was uploaded (expected multipart field "file")',
      errorCode: 'VALIDATION_ERROR',
    });
  }
  return file;
}

// Google Classroom/Drive-style LMS. Student routes are read-only browsing +
// task submission; Faculty/HoD routes create/manage folders, resources,
// tasks, grading, and the lesson plan. Guarded per-method since the two
// halves need different role sets.
@Controller('me/lms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LmsController {
  constructor(private readonly lmsService: LmsService) {}

  // --- Student ---

  /** GET /api/v1/me/lms/subjects */
  @Get('subjects')
  @Roles(ROLES.STUDENT)
  getMySubjects(@CurrentUser() user: JwtPayload) {
    return this.lmsService.getMySubjects(user.sub);
  }

  /** GET /api/v1/me/lms/subjects/:subjectId/folders */
  @Get('subjects/:subjectId/folders')
  @Roles(ROLES.STUDENT)
  getStudentFolders(
    @Param('subjectId', ParseIntPipe) subjectId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.getStudentFolders(subjectId, user.sub);
  }

  /** GET /api/v1/me/lms/subjects/:subjectId/tasks */
  @Get('subjects/:subjectId/tasks')
  @Roles(ROLES.STUDENT)
  getStudentTasks(
    @Param('subjectId', ParseIntPipe) subjectId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.getStudentTasks(subjectId, user.sub);
  }

  /** POST /api/v1/me/lms/tasks/:taskId/submit */
  @Post('tasks/:taskId/submit')
  @Roles(ROLES.STUDENT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SUBMISSION_BYTES } }))
  submitTask(
    @Param('taskId', ParseIntPipe) taskId: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.submitTask(taskId, user.sub, requireFile(file));
  }

  /** GET /api/v1/me/lms/subjects/:subjectId/lesson-plan */
  @Get('subjects/:subjectId/lesson-plan')
  @Roles(ROLES.STUDENT)
  getStudentLessonPlan(
    @Param('subjectId', ParseIntPipe) subjectId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.getStudentLessonPlan(subjectId, user.sub);
  }

  // --- Shared (student read within their class, faculty read within their own folder) ---

  /** GET /api/v1/me/lms/folders/:folderId/resources */
  @Get('folders/:folderId/resources')
  @Roles(ROLES.STUDENT, ROLES.FACULTY, ROLES.HOD)
  getFolderResources(
    @Param('folderId', ParseIntPipe) folderId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.getFolderResources(folderId, user);
  }

  // --- Faculty / HoD ---

  /** GET /api/v1/me/lms/my-subjects */
  @Get('my-subjects')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMyTeachingSubjects(@CurrentUser() user: JwtPayload) {
    return this.lmsService.getMyTeachingSubjects(user.sub);
  }

  /** GET /api/v1/me/lms/my-subjects/:subjectId/folders */
  @Get('my-subjects/:subjectId/folders')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getFacultyFolders(
    @Param('subjectId', ParseIntPipe) subjectId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.getFacultyFolders(subjectId, user.sub);
  }

  /** POST /api/v1/me/lms/folders */
  @Post('folders')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @HttpCode(HttpStatus.CREATED)
  createFolder(@Body() dto: CreateFolderDto, @CurrentUser() user: JwtPayload) {
    return this.lmsService.createFolder(dto, user.sub);
  }

  /** PATCH /api/v1/me/lms/folders/:id */
  @Patch('folders/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  updateFolder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFolderDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.updateFolder(id, dto, user.sub);
  }

  /** DELETE /api/v1/me/lms/folders/:id */
  @Delete('folders/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  deleteFolder(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.lmsService.deleteFolder(id, user.sub);
  }

  /** POST /api/v1/me/lms/folders/:id/resources/file */
  @Post('folders/:id/resources/file')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RESOURCE_BYTES } }))
  addFileResource(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFileResourceDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.addFileResource(id, dto, user.sub, requireFile(file));
  }

  /** POST /api/v1/me/lms/folders/:id/resources/link */
  @Post('folders/:id/resources/link')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @HttpCode(HttpStatus.CREATED)
  addLinkResource(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateLinkResourceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.addLinkResource(id, dto, user.sub);
  }

  /** DELETE /api/v1/me/lms/resources/:id */
  @Delete('resources/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  deleteResource(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.lmsService.deleteResource(id, user.sub);
  }

  /** GET /api/v1/me/lms/my-subjects/:subjectId/tasks?class_id= */
  @Get('my-subjects/:subjectId/tasks')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getFacultyTasks(
    @Param('subjectId', ParseIntPipe) subjectId: number,
    @Query('class_id', new ParseIntPipe({ optional: true })) classId: number | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.getFacultyTasks(subjectId, classId, user.sub);
  }

  /** POST /api/v1/me/lms/tasks */
  @Post('tasks')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @HttpCode(HttpStatus.CREATED)
  createTask(@Body() dto: CreateTaskDto, @CurrentUser() user: JwtPayload) {
    return this.lmsService.createTask(dto, user.sub);
  }

  /** DELETE /api/v1/me/lms/tasks/:id */
  @Delete('tasks/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  deleteTask(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.lmsService.deleteTask(id, user.sub);
  }

  /** GET /api/v1/me/lms/tasks/:id/submissions */
  @Get('tasks/:id/submissions')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getTaskSubmissions(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.lmsService.getTaskSubmissions(id, user.sub);
  }

  /** PATCH /api/v1/me/lms/submissions/:id */
  @Patch('submissions/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  gradeSubmission(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GradeSubmissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.gradeSubmission(id, dto, user.sub);
  }

  /** GET /api/v1/me/lms/my-subjects/:subjectId/lesson-plan?class_id= */
  @Get('my-subjects/:subjectId/lesson-plan')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getFacultyLessonPlan(
    @Param('subjectId', ParseIntPipe) subjectId: number,
    @Query('class_id', ParseIntPipe) classId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.getFacultyLessonPlan(subjectId, classId, user.sub);
  }

  /** POST /api/v1/me/lms/lesson-plan/sessions */
  @Post('lesson-plan/sessions')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @HttpCode(HttpStatus.CREATED)
  createLessonSession(@Body() dto: CreateLessonSessionDto, @CurrentUser() user: JwtPayload) {
    return this.lmsService.createLessonSession(dto, user.sub);
  }

  /** PATCH /api/v1/me/lms/lesson-plan/sessions/:id */
  @Patch('lesson-plan/sessions/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  updateLessonSession(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLessonSessionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsService.updateLessonSession(id, dto, user.sub);
  }

  /** DELETE /api/v1/me/lms/lesson-plan/sessions/:id */
  @Delete('lesson-plan/sessions/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  deleteLessonSession(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.lmsService.deleteLessonSession(id, user.sub);
  }
}
