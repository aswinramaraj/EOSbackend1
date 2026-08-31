import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { UpdateAchievementDto } from 'src/modules/sports-admin/achievements/dto/update-achievement.dto';
import { AchievementsService } from 'src/modules/sports-admin/achievements/achievements.service';
import { ListDrivesQueryDto } from 'src/modules/placement/drives/dto/list-drives-query.dto';
import { CreateDriveApplicationDto } from 'src/modules/placement/drives/dto/create-drive-application.dto';
import { UpdateDriveApplicationStatusDto } from 'src/modules/placement/drives/dto/update-drive-application-status.dto';
import { DrivesService } from 'src/modules/placement/drives/drives.service';
import { AddPlacementEntryDto } from './dto/add-placement-entry.dto';
import { AddCertificationEntryDto } from './dto/add-certification-entry.dto';
import { AddCompetitionEntryDto } from './dto/add-competition-entry.dto';
import { AddHackathonEntryDto } from './dto/add-hackathon-entry.dto';
import { UpdateCertificationEntryDto } from './dto/update-certification-entry.dto';
import { UpdateCompetitionEntryDto } from './dto/update-competition-entry.dto';
import { UpdateHackathonEntryDto } from './dto/update-hackathon-entry.dto';
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
    private readonly achievements: AchievementsService,
    private readonly drives: DrivesService,
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

  @Patch('placements/drives/:driveId/applications/:studentId')
  updatePlacementApplication(
    @Param('driveId', ParseIntPipe) driveId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: UpdateDriveApplicationStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.drives.updateApplicationStatus(user, driveId, studentId, dto);
  }

  @Delete('placements/drives/:driveId/applications/:studentId')
  removePlacementApplication(
    @Param('driveId', ParseIntPipe) driveId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.drives.removeApplication(driveId, studentId);
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

  @Patch('awards/:id')
  updateAward(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAchievementDto,
  ) {
    return this.achievements.update(id, dto);
  }

  @Delete('awards/:id')
  removeAward(@Param('id', ParseIntPipe) id: number) {
    return this.achievements.remove(id);
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

  @Patch('certifications/:id')
  updateCertificationEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCertificationEntryDto,
  ) {
    return this.studentDevelopment.updateCertificationEntry(id, dto);
  }

  @Delete('certifications/:id')
  removeCertificationEntry(@Param('id', ParseIntPipe) id: number) {
    return this.studentDevelopment.removeCertificationEntry(id);
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

  @Patch('competitions/:id')
  updateCompetitionEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCompetitionEntryDto,
  ) {
    return this.studentDevelopment.updateCompetitionEntry(id, dto);
  }

  @Delete('competitions/:id')
  removeCompetitionEntry(@Param('id', ParseIntPipe) id: number) {
    return this.studentDevelopment.removeCompetitionEntry(id);
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

  @Patch('hackathons/:id')
  updateHackathonEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHackathonEntryDto,
  ) {
    return this.studentDevelopment.updateHackathonEntry(id, dto);
  }

  @Delete('hackathons/:id')
  removeHackathonEntry(@Param('id', ParseIntPipe) id: number) {
    return this.studentDevelopment.removeHackathonEntry(id);
  }
}
