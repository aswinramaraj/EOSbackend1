import {
  Body,
  Controller,
  Get,
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
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalPlacementsService } from 'src/modules/principal/placements/placements.service';
import { CreateAchievementDto } from 'src/modules/sports-admin/achievements/dto/create-achievement.dto';
import { ListDrivesQueryDto } from 'src/modules/placement/drives/dto/list-drives-query.dto';
import { CreateDriveApplicationDto } from 'src/modules/placement/drives/dto/create-drive-application.dto';
import { AddPlacementEntryDto } from './dto/add-placement-entry.dto';
import { AddCertificationEntryDto } from './dto/add-certification-entry.dto';
import { AddCompetitionEntryDto } from './dto/add-competition-entry.dto';
import { AddHackathonEntryDto } from './dto/add-hackathon-entry.dto';
import { IqacStudentDevelopmentService } from './iqac-student-development.service';

/**
 * GET /api/v1/me/iqac/student-development/* — IQAC only, read-only.
 *
 * `placements/*` delegates straight to PrincipalPlacementsService — the
 * exact same real placement_drives/student_drive_applications data
 * Principal's own Placements page uses, not a duplicate query. `awards`
 * is a new aggregate (see IqacStudentDevelopmentService) built on top of
 * the sports-admin AchievementsService. Certifications/Competitions/
 * Hackathons have no route here at all — nothing real backs them yet.
 */
@Controller('me/iqac/student-development')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacStudentDevelopmentController {
  constructor(
    private readonly studentDevelopment: IqacStudentDevelopmentService,
    private readonly placements: PrincipalPlacementsService,
  ) {}

  @Get('placements/summary')
  placementsSummary() {
    return this.placements.summary();
  }

  @Get('placements/departments')
  placementsDepartments() {
    return this.placements.listDepartments();
  }

  @Get('placements/quality')
  placementsQuality() {
    return this.studentDevelopment.placementsQuality();
  }

  @Get('placements/recruiters')
  leadingRecruiters(@Query('batch_id') batchId?: string) {
    return this.studentDevelopment.leadingRecruiters(
      batchId ? Number(batchId) : undefined,
    );
  }

  @Get('placements/recruiters/:companyId')
  recruiterStudents(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.placements.recruiterStudents(companyId);
  }

  @Get('placements/drives')
  listDrives(@Query() query: ListDrivesQueryDto) {
    return this.studentDevelopment.listDrives(query);
  }

  @Post('placements/drives/:driveId/applications')
  addPlacementApplication(
    @Param('driveId', ParseIntPipe) driveId: number,
    @Body() dto: CreateDriveApplicationDto,
  ) {
    return this.studentDevelopment.addPlacementApplication(driveId, dto);
  }

  @Post('placements/drives/:driveId/entries')
  addPlacementEntry(
    @Param('driveId', ParseIntPipe) driveId: number,
    @Body() dto: AddPlacementEntryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentDevelopment.addPlacementEntry(driveId, dto, user);
  }

  @Get('awards/quality')
  awardsQuality() {
    return this.studentDevelopment.awardsQuality();
  }

  @Get('awards')
  leadingAwardEvents(@Query('batch_id') batchId?: string) {
    return this.studentDevelopment.leadingAwardEvents(
      batchId ? Number(batchId) : undefined,
    );
  }

  @Get('awards/departments')
  awardDepartments(@Query('batch_id') batchId?: string) {
    return this.studentDevelopment.awardDepartments(
      batchId ? Number(batchId) : undefined,
    );
  }

  @Post('awards')
  createAward(@Body() dto: CreateAchievementDto) {
    return this.studentDevelopment.createAward(dto);
  }

  @Get('awards/:eventName')
  eventParticipants(@Param('eventName') eventName: string) {
    return this.studentDevelopment.eventParticipants(eventName);
  }

  @Get('certifications/quality')
  certificationsQuality() {
    return this.studentDevelopment.certificationsQuality();
  }

  @Get('certifications')
  certifications(@Query('batch_id') batchId?: string) {
    return this.studentDevelopment.certifications(
      batchId ? Number(batchId) : undefined,
    );
  }

  @Post('certifications')
  addCertificationEntry(@Body() dto: AddCertificationEntryDto) {
    return this.studentDevelopment.addCertificationEntry(dto);
  }

  @Get('competitions/quality')
  competitionsQuality() {
    return this.studentDevelopment.competitionsQuality();
  }

  @Get('competitions')
  competitions(@Query('batch_id') batchId?: string) {
    return this.studentDevelopment.competitions(
      batchId ? Number(batchId) : undefined,
    );
  }

  @Post('competitions')
  addCompetitionEntry(@Body() dto: AddCompetitionEntryDto) {
    return this.studentDevelopment.addCompetitionEntry(dto);
  }

  @Get('hackathons/quality')
  hackathonsQuality() {
    return this.studentDevelopment.hackathonsQuality();
  }

  @Get('hackathons')
  hackathons(@Query('batch_id') batchId?: string) {
    return this.studentDevelopment.hackathons(
      batchId ? Number(batchId) : undefined,
    );
  }

  @Post('hackathons')
  addHackathonEntry(@Body() dto: AddHackathonEntryDto) {
    return this.studentDevelopment.addHackathonEntry(dto);
  }
}
