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
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalFacultyService } from 'src/modules/principal/faculty/faculty.service';
import { CreatePublicationDto } from 'src/modules/principal/faculty/dto/create-publication.dto';
import { AddPublicationEntryDto } from './dto/add-publication-entry.dto';
import { AddDevelopmentProgramEntryDto } from './dto/add-development-program-entry.dto';
import { AddResearchEntryDto } from './dto/add-research-entry.dto';
import { AddPatentEntryDto } from './dto/add-patent-entry.dto';
import { AddFacultyCertificationEntryDto } from './dto/add-faculty-certification-entry.dto';
import { UpdateDevelopmentProgramEntryDto } from './dto/update-development-program-entry.dto';
import { UpdateFacultyCertificationEntryDto } from './dto/update-faculty-certification-entry.dto';
import { UpdatePublicationEntryDto } from './dto/update-publication-entry.dto';
import { UpdateResearchEntryDto } from './dto/update-research-entry.dto';
import { UpdatePatentEntryDto } from './dto/update-patent-entry.dto';
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

  @Patch('publications/:id')
  updatePublicationEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePublicationEntryDto,
  ) {
    return this.facultyDevelopment.updatePublicationEntry(id, dto);
  }

  @Delete('publications/:id')
  removePublicationEntry(@Param('id', ParseIntPipe) id: number) {
    return this.facultyDevelopment.removePublicationEntry(id);
  }

  @Get('fdp/quality')
  fdpQuality() {
    return this.facultyDevelopment.fdpQuality();
  }

  @Get('fdp')
  fdp(@Query('department_id') departmentId?: string) {
    return this.facultyDevelopment.fdp(
      departmentId ? Number(departmentId) : undefined,
    );
  }

  @Post('fdp')
  addFdpEntry(@Body() dto: AddDevelopmentProgramEntryDto) {
    return this.facultyDevelopment.addFdpEntry(dto);
  }

  @Patch('fdp/:id')
  updateFdpEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDevelopmentProgramEntryDto,
  ) {
    return this.facultyDevelopment.updateDevelopmentProgramEntry(id, dto);
  }

  @Delete('fdp/:id')
  removeFdpEntry(@Param('id', ParseIntPipe) id: number) {
    return this.facultyDevelopment.removeDevelopmentProgramEntry(id);
  }

  @Get('sttp/quality')
  sttpQuality() {
    return this.facultyDevelopment.sttpQuality();
  }

  @Get('sttp')
  sttp(@Query('department_id') departmentId?: string) {
    return this.facultyDevelopment.sttp(
      departmentId ? Number(departmentId) : undefined,
    );
  }

  @Post('sttp')
  addSttpEntry(@Body() dto: AddDevelopmentProgramEntryDto) {
    return this.facultyDevelopment.addSttpEntry(dto);
  }

  @Patch('sttp/:id')
  updateSttpEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDevelopmentProgramEntryDto,
  ) {
    return this.facultyDevelopment.updateDevelopmentProgramEntry(id, dto);
  }

  @Delete('sttp/:id')
  removeSttpEntry(@Param('id', ParseIntPipe) id: number) {
    return this.facultyDevelopment.removeDevelopmentProgramEntry(id);
  }

  @Get('research/quality')
  researchQuality() {
    return this.facultyDevelopment.researchQuality();
  }

  @Get('research')
  research(@Query('department_id') departmentId?: string) {
    return this.facultyDevelopment.research(
      departmentId ? Number(departmentId) : undefined,
    );
  }

  @Post('research')
  addResearchEntry(@Body() dto: AddResearchEntryDto) {
    return this.facultyDevelopment.addResearchEntry(dto);
  }

  @Patch('research/:id')
  updateResearchEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateResearchEntryDto,
  ) {
    return this.facultyDevelopment.updateResearchEntry(id, dto);
  }

  @Delete('research/:id')
  removeResearchEntry(@Param('id', ParseIntPipe) id: number) {
    return this.facultyDevelopment.removeResearchEntry(id);
  }

  @Get('patents/quality')
  patentsQuality() {
    return this.facultyDevelopment.patentsQuality();
  }

  @Get('patents')
  patents(@Query('department_id') departmentId?: string) {
    return this.facultyDevelopment.patents(
      departmentId ? Number(departmentId) : undefined,
    );
  }

  @Post('patents')
  addPatentEntry(@Body() dto: AddPatentEntryDto) {
    return this.facultyDevelopment.addPatentEntry(dto);
  }

  @Patch('patents/:id')
  updatePatentEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePatentEntryDto,
  ) {
    return this.facultyDevelopment.updatePatentEntry(id, dto);
  }

  @Delete('patents/:id')
  removePatentEntry(@Param('id', ParseIntPipe) id: number) {
    return this.facultyDevelopment.removePatentEntry(id);
  }

  @Get('certifications/quality')
  facultyCertificationsQuality() {
    return this.facultyDevelopment.facultyCertificationsQuality();
  }

  @Get('certifications')
  facultyCertifications(@Query('department_id') departmentId?: string) {
    return this.facultyDevelopment.facultyCertifications(
      departmentId ? Number(departmentId) : undefined,
    );
  }

  @Post('certifications')
  addFacultyCertificationEntry(@Body() dto: AddFacultyCertificationEntryDto) {
    return this.facultyDevelopment.addFacultyCertificationEntry(dto);
  }

  @Patch('certifications/:id')
  updateFacultyCertificationEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFacultyCertificationEntryDto,
  ) {
    return this.facultyDevelopment.updateFacultyCertificationEntry(id, dto);
  }

  @Delete('certifications/:id')
  removeFacultyCertificationEntry(@Param('id', ParseIntPipe) id: number) {
    return this.facultyDevelopment.removeFacultyCertificationEntry(id);
  }
}
