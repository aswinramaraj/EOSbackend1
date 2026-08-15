import { Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreRecordsService } from './medical-centre-records.service';
import { UpsertHealthRecordDto } from './dto/upsert-health-record.dto';

@Controller('me/medical-centre-records')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreRecordsController {
  constructor(private readonly service: MedicalCentreRecordsService) {}

  /** GET /api/v1/me/medical-centre-records — every student with a medical visit or declared health record. */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** PUT /api/v1/me/medical-centre-records/:studentId — declare/update a student's blood group, allergies, chronic condition, guardian. */
  @Put(':studentId')
  upsert(@Param('studentId', ParseIntPipe) studentId: number, @Body() dto: UpsertHealthRecordDto) {
    return this.service.upsert(studentId, dto);
  }
}
