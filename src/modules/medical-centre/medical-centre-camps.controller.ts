import {
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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreCampsService } from './medical-centre-camps.service';
import {
  AddCampRegistrationDto,
  BulkCampRegistrationDto,
  CreateCampDto,
  UpdateCampDto,
  UpdateCampRegistrationDto,
} from './dto/medical-crud.dto';
import { MedicalCampRegistrationsService } from './medical-camp-registrations.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

@Controller('me/medical-centre-camps')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreCampsController {
  constructor(
    private readonly service: MedicalCentreCampsService,
    private readonly registrations: MedicalCampRegistrationsService,
  ) {}

  /** GET /api/v1/me/medical-centre-camps */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** POST /api/v1/me/medical-centre-camps */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCampDto) {
    return this.service.create(dto);
  }

  /** PATCH /api/v1/me/medical-centre-camps/:id */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCampDto) {
    return this.service.update(id, dto);
  }

  /** DELETE /api/v1/me/medical-centre-camps/:id */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // ── Roster ────────────────────────────────────────────────────────────────
  //
  // `register-batch` used to sit here: it added 60 to registered_count and
  // recorded nobody, so the figure on screen stood for no actual people. It is
  // gone, replaced by the endpoints below which register named students and
  // faculty and keep registered_count derived from that roster.

  /** GET /api/v1/me/medical-centre-camps/:id/registrations */
  @Get(':id/registrations')
  listRegistrations(@Param('id', ParseIntPipe) id: number) {
    return this.registrations.list(id);
  }

  /** POST /api/v1/me/medical-centre-camps/:id/registrations */
  @Post(':id/registrations')
  @HttpCode(HttpStatus.CREATED)
  addRegistration(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddCampRegistrationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.registrations.add(id, dto, user.sub);
  }

  /**
   * POST /api/v1/me/medical-centre-camps/:id/registrations/bulk
   * Declared before the parameterised routes below so the literal `bulk`
   * segment is not swallowed by `:registrationId`.
   */
  @Post(':id/registrations/bulk')
  @HttpCode(HttpStatus.CREATED)
  addRegistrations(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BulkCampRegistrationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.registrations.addMany(id, dto.people, user.sub);
  }

  /** PATCH /api/v1/me/medical-centre-camps/:id/registrations/:registrationId */
  @Patch(':id/registrations/:registrationId')
  updateRegistration(
    @Param('id', ParseIntPipe) id: number,
    @Param('registrationId', ParseIntPipe) registrationId: number,
    @Body() dto: UpdateCampRegistrationDto,
  ) {
    return this.registrations.update(id, registrationId, dto);
  }

  /** DELETE /api/v1/me/medical-centre-camps/:id/registrations/:registrationId */
  @Delete(':id/registrations/:registrationId')
  removeRegistration(
    @Param('id', ParseIntPipe) id: number,
    @Param('registrationId', ParseIntPipe) registrationId: number,
  ) {
    return this.registrations.remove(id, registrationId);
  }
}
