import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalFacultyService } from 'src/modules/principal/faculty/faculty.service';
import { CreatePublicationDto } from 'src/modules/principal/faculty/dto/create-publication.dto';
import { AddPublicationEntryDto } from './dto/add-publication-entry.dto';
import { AddDevelopmentProgramEntryDto } from './dto/add-development-program-entry.dto';
import { AddResearchEntryDto } from './dto/add-research-entry.dto';
import { AddPatentEntryDto } from './dto/add-patent-entry.dto';
import { AddFacultyCertificationEntryDto } from './dto/add-faculty-certification-entry.dto';
import { IqacFacultyDevelopmentService } from './iqac-faculty-development.service';

/**
 * GET /api/v1/me/iqac/faculty-development/* — IQAC only, read-only.
 *
 * `publications/venues*`/`publications/departments` delegate straight to
 * PrincipalFacultyService — the exact same real faculty_publications data,
 * not a duplicate query. `publications/quality` and `publications/entries`
 * are new aggregates (see IqacFacultyDevelopmentService). FDP/STTP/
 * Certifications/Research/Patents have no route here at all — nothing
 * real backs them yet (see iqac_faculty_development_gaps.sql).
 */
@Controller('me/iqac/faculty-development')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacFacultyDevelopmentController {
  constructor(
    private readonly faculty: PrincipalFacultyService,
    private readonly facultyDevelopment: IqacFacultyDevelopmentService,
  ) {}

  @Get('publications/venues')
  leadingPublicationVenues(@Query('indexing') indexing?: string) {
    return this.facultyDevelopment.publicationVenues(indexing);
  }

  @Get('publications/venues/:venue')
  venuePublications(@Param('venue') venue: string) {
    return this.faculty.venuePublications(venue);
  }

  @Get('publications/departments')
  publicationDepartments() {
    return this.faculty.publicationDepartments();
  }

  @Get('publications/indexing-options')
  indexingOptions() {
    return this.facultyDevelopment.indexingOptions();
  }

  @Get('publications/quality')
  publicationsQuality() {
    return this.facultyDevelopment.publicationsQuality();
  }

  @Post('publications')
  createPublication(@Body() dto: CreatePublicationDto) {
    return this.faculty.createPublication(dto);
  }

  @Post('publications/entries')
  addPublicationEntry(@Body() dto: AddPublicationEntryDto) {
    return this.facultyDevelopment.addPublicationEntry(dto);
  }

  @Get('fdp/quality')
  fdpQuality() {
    return this.facultyDevelopment.fdpQuality();
  }

  @Get('fdp')
  fdp(@Query('department_id') departmentId?: string) {
    return this.facultyDevelopment.fdp(departmentId ? Number(departmentId) : undefined);
  }

  @Post('fdp')
  addFdpEntry(@Body() dto: AddDevelopmentProgramEntryDto) {
    return this.facultyDevelopment.addFdpEntry(dto);
  }

  @Get('sttp/quality')
  sttpQuality() {
    return this.facultyDevelopment.sttpQuality();
  }

  @Get('sttp')
  sttp(@Query('department_id') departmentId?: string) {
    return this.facultyDevelopment.sttp(departmentId ? Number(departmentId) : undefined);
  }

  @Post('sttp')
  addSttpEntry(@Body() dto: AddDevelopmentProgramEntryDto) {
    return this.facultyDevelopment.addSttpEntry(dto);
  }

  @Get('research/quality')
  researchQuality() {
    return this.facultyDevelopment.researchQuality();
  }

  @Get('research')
  research(@Query('department_id') departmentId?: string) {
    return this.facultyDevelopment.research(departmentId ? Number(departmentId) : undefined);
  }

  @Post('research')
  addResearchEntry(@Body() dto: AddResearchEntryDto) {
    return this.facultyDevelopment.addResearchEntry(dto);
  }

  @Get('patents/quality')
  patentsQuality() {
    return this.facultyDevelopment.patentsQuality();
  }

  @Get('patents')
  patents(@Query('department_id') departmentId?: string) {
    return this.facultyDevelopment.patents(departmentId ? Number(departmentId) : undefined);
  }

  @Post('patents')
  addPatentEntry(@Body() dto: AddPatentEntryDto) {
    return this.facultyDevelopment.addPatentEntry(dto);
  }

  @Get('certifications/quality')
  facultyCertificationsQuality() {
    return this.facultyDevelopment.facultyCertificationsQuality();
  }

  @Get('certifications')
  facultyCertifications(@Query('department_id') departmentId?: string) {
    return this.facultyDevelopment.facultyCertifications(departmentId ? Number(departmentId) : undefined);
  }

  @Post('certifications')
  addFacultyCertificationEntry(@Body() dto: AddFacultyCertificationEntryDto) {
    return this.facultyDevelopment.addFacultyCertificationEntry(dto);
  }
}
