import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreOpdService } from './medical-centre-opd.service';
import { OpdSearchQueryDto } from './dto/medical-crud.dto';
import { CreateWalkinDto } from './dto/create-walkin.dto';

@Controller('me/medical-centre-opd-queue')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreOpdController {
  constructor(private readonly service: MedicalCentreOpdService) {}

  /**
   * GET /api/v1/me/medical-centre-opd-queue/search?q=&kind=
   *
   * Declared before any parameterised route so the literal "search" segment is
   * not captured by it.
   */
  @Get('search')
  searchPatients(@Query() query: OpdSearchQueryDto) {
    return this.service.searchPatients(query);
  }

  /** GET /api/v1/me/medical-centre-opd-queue — today's OPD queue, or ?date=YYYY-MM-DD for a past day's history. */
  @Get()
  getQueue(@Query('date') date?: string) {
    return this.service.getQueue(date);
  }

  /** POST /api/v1/me/medical-centre-opd-queue — add a walk-in, identified by student ID / register number or faculty email. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  addWalkin(@Body() dto: CreateWalkinDto) {
    return this.service.addWalkin(dto);
  }

  /** POST /api/v1/me/medical-centre-opd-queue/:id/advance — cycles waiting → consult → done → waiting. */
  @Post(':id/advance')
  advance(@Param('id', ParseIntPipe) id: number) {
    return this.service.advance(id);
  }
}
