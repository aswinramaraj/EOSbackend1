import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ArrearsService } from './arrears.service';
import { ListArrearsQueryDto } from './dto/list-arrears-query.dto';
import { ScheduleSupplementaryDto } from './dto/schedule-supplementary.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';

@Controller('arrears')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ArrearsController {
  constructor(private readonly arrearsService: ArrearsService) {}

  @Get('overview')
  async getOverview(@Query() query: ListArrearsQueryDto) {
    const overview = await this.arrearsService.getOverview(query);
    return ApiResponse.ok(overview, 'Arrear overview fetched successfully.');
  }

  @Get('students/:id/history')
  async getStudentHistory(@Param('id', ParseIntPipe) id: number) {
    const history = await this.arrearsService.getStudentHistory(id);
    return ApiResponse.ok(history, 'Arrear history fetched successfully.');
  }

  @Post('supplementary')
  async scheduleSupplementary(
    @Body() dto: ScheduleSupplementaryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const exam = await this.arrearsService.scheduleSupplementary(dto, user.sub);
    return ApiResponse.created(
      exam,
      'Supplementary exam scheduled successfully.',
    );
  }
}
