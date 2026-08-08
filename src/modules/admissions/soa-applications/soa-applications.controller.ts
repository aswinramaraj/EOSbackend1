import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SoaApplicationsService } from './soa-applications.service';
import { CreateSoaApplicationDto } from './dto/create-soa-application.dto';
import { UpdateSoaApplicationDto } from './dto/update-soa-application.dto';
import { UpdateSoaStatusDto } from './dto/update-soa-status.dto';
import { CreatePerfectEntryDto } from './dto/create-perfect-entry.dto';
import { ListSoaApplicationsQueryDto } from './dto/list-soa-applications-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';

@Controller('soa-applications')
export class SoaApplicationsController {
  constructor(
    private readonly soaApplicationsService: SoaApplicationsService,
  ) {}

  /**
   * POST /api/v1/soa-applications
   *
   * Error responses:
   *  400 VALIDATION_ERROR      – missing first_name, or a malformed field
   *  401 UNAUTHORIZED          – missing/invalid JWT
   *  403 FORBIDDEN             – authenticated but not admin
   *  422 INVALID_CUTOFF_RANGE  – a cutoff mark outside 0-100
   *  500 INTERNAL_ERROR        – unexpected server failure
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  create(@Body() createSoaApplicationDto: CreateSoaApplicationDto) {
    return this.soaApplicationsService.create(createSoaApplicationDto);
  }

  /**
   * PATCH /api/v1/soa-applications/:id/status
   *
   * Error responses:
   *  400 VALIDATION_ERROR           – missing/invalid status, or id isn't an integer
   *  401 UNAUTHORIZED               – missing/invalid JWT
   *  403 FORBIDDEN                  – authenticated but not admin
   *  404 SOA_APPLICATION_NOT_FOUND  – no application with this id
   *  422 INVALID_STATUS_TRANSITION  – status is valid but not reachable from the current one
   *  500 INTERNAL_ERROR             – unexpected server failure
   */
  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSoaStatusDto,
  ) {
    return this.soaApplicationsService.updateStatus(id, dto);
  }

  /**
   * POST /api/v1/soa-applications/:id/perfect-entry
   *
   * Admin-only (see the docblock on SoaApplicationsService.perfectEntry for
   * why the spec's "student self-service" flow isn't implementable yet —
   * no pre-auth mechanism exists for a not-yet-created student login).
   *
   * Error responses:
   *  400 VALIDATION_ERROR           – malformed field, future date_of_birth,
   *                                   duplicate mark_number/address_type
   *  401 UNAUTHORIZED               – missing/invalid JWT
   *  403 FORBIDDEN                  – authenticated but not admin
   *  404 SOA_APPLICATION_NOT_FOUND / COURSE_NOT_FOUND / QUOTA_NOT_FOUND /
   *      BATCH_NOT_FOUND / TRANSPORT_STAGE_NOT_FOUND / HOSTEL_ROOM_TYPE_NOT_FOUND
   *  409 PERFECT_ENTRY_ALREADY_DONE / EMAIL_ALREADY_EXISTS /
   *      STUDENT_ID_NO_ALREADY_EXISTS / ADMISSION_NO_ALREADY_EXISTS
   *  422 PERFECT_ENTRY_NOT_ALLOWED / INVALID_ADDRESS_TYPE / MISSING_CONDITIONAL_FIELD
   *  500 INTERNAL_ERROR
   */
  @Post(':id/perfect-entry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  perfectEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePerfectEntryDto,
  ) {
    return this.soaApplicationsService.perfectEntry(id, dto);
  }

  /**
   * GET /api/v1/soa-applications
   * The admissions pipeline: every application, filterable by status and
   * searchable by name/email/contact, with pagination.
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  findAll(@Query() query: ListSoaApplicationsQueryDto) {
    return this.soaApplicationsService.findAll(query);
  }

  /**
   * GET /api/v1/soa-applications/:id
   *
   * Error responses:
   *  404 SOA_APPLICATION_NOT_FOUND
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.soaApplicationsService.findOne(id);
  }

  /**
   * PATCH /api/v1/soa-applications/:id
   * Corrects the draft's own fields. Locked once admission_confirmed.
   *
   * Error responses:
   *  404 SOA_APPLICATION_NOT_FOUND
   *  422 APPLICATION_NOT_EDITABLE / INVALID_CUTOFF_RANGE
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateSoaApplicationDto: UpdateSoaApplicationDto,
  ) {
    return this.soaApplicationsService.update(id, updateSoaApplicationDto);
  }

  /**
   * DELETE /api/v1/soa-applications/:id
   * Hard delete — restricted to untouched drafts still in 'applied' status.
   *
   * Error responses:
   *  404 SOA_APPLICATION_NOT_FOUND
   *  409 APPLICATION_NOT_DELETABLE
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.soaApplicationsService.remove(id);
  }
}
