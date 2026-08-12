import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { TransportComplianceService } from './transport-compliance.service';
import { UpsertBusDocumentDto } from './dto/upsert-bus-document.dto';

@Controller('me/compliance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.TRANSPORT)
export class TransportComplianceController {
  constructor(private readonly service: TransportComplianceService) {}

  /** GET /api/v1/me/compliance — statutory document register, one row per bus. */
  @Get()
  getCompliance() {
    return this.service.getCompliance();
  }

  /** POST /api/v1/me/compliance/documents — add or update one bus's document entry. */
  @Post('documents')
  @HttpCode(HttpStatus.OK)
  upsertDocument(@Body() dto: UpsertBusDocumentDto) {
    return this.service.upsertDocument(dto);
  }
}
