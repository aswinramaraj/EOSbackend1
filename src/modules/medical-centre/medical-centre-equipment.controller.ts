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
import { MedicalCentreEquipmentService } from './medical-centre-equipment.service';
import {
  CreateMedicalEquipmentDto,
  UpdateMedicalEquipmentDto,
} from './dto/medical-crud.dto';

@Controller('me/medical-centre-equipment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreEquipmentController {
  constructor(private readonly service: MedicalCentreEquipmentService) {}

  /** GET /api/v1/me/medical-centre-equipment */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** POST /api/v1/me/medical-centre-equipment */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateMedicalEquipmentDto) {
    return this.service.create(dto);
  }

  /** PATCH /api/v1/me/medical-centre-equipment/:id */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMedicalEquipmentDto,
  ) {
    return this.service.update(id, dto);
  }

  /** DELETE /api/v1/me/medical-centre-equipment/:id */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  /** POST /api/v1/me/medical-centre-equipment/:id/toggle-condition */
  @Post(':id/toggle-condition')
  toggleCondition(@Param('id', ParseIntPipe) id: number) {
    return this.service.toggleCondition(id);
  }
}
