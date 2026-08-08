import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { IqacStudentOdsService } from './iqac-student-ods.service';
import { ListIqacStudentOdQueryDto } from './dto/list-iqac-student-od-query.dto';
import { VerifyStudentOdDto } from './dto/verify-student-od.dto';

@Controller('iqac')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacStudentOdsController {
  constructor(private readonly iqacStudentOdsService: IqacStudentOdsService) {}

  /** GET /api/v1/iqac/student-ods — IQAC only. */
  @Get('student-ods')
  findAll(@Query() query: ListIqacStudentOdQueryDto) {
    return this.iqacStudentOdsService.findAll(query);
  }

  /** GET /api/v1/iqac/student-ods/:id — IQAC only. Full detail. */
  @Get('student-ods/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.iqacStudentOdsService.findOne(id);
  }

  /** PATCH /api/v1/iqac/student-ods/:id/verify — IQAC only. */
  @Patch('student-ods/:id/verify')
  verify(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VerifyStudentOdDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.iqacStudentOdsService.verify(id, dto, user.sub);
  }
}
