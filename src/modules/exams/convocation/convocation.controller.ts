import {
  Body,
  Controller,
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
import { ApiResponse, ROLES } from 'src/common';
import { ConvocationService } from './convocation.service';
import { ListConvocationQueryDto } from './dto/list-convocation-query.dto';
import { VerifyConvocationDto } from './dto/verify-convocation.dto';

@Controller('convocation-registrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ConvocationController {
  constructor(private readonly service: ConvocationService) {}

  @Get('stats')
  async getStats() {
    const stats = await this.service.getStats();
    return ApiResponse.ok(stats, 'Convocation stats fetched successfully.');
  }

  @Get()
  async findAll(@Query() query: ListConvocationQueryDto) {
    const records = await this.service.findAll(query);
    return ApiResponse.ok(
      records,
      'Convocation registrations fetched successfully.',
    );
  }

  @Post('verify')
  async verify(@Body() dto: VerifyConvocationDto) {
    const record = await this.service.verify(dto);
    return ApiResponse.created(
      record,
      'Degree eligibility verified successfully.',
    );
  }

  @Patch(':id/register')
  async register(@Param('id', ParseIntPipe) id: number) {
    const record = await this.service.register(id);
    return ApiResponse.ok(
      record,
      'Student registered for convocation successfully.',
    );
  }

  @Patch(':id/award-degree')
  async awardDegree(@Param('id', ParseIntPipe) id: number) {
    const record = await this.service.awardDegree(id);
    return ApiResponse.ok(record, 'Degree marked as awarded successfully.');
  }

  @Post(':id/notify')
  async notify(@Param('id', ParseIntPipe) id: number) {
    const notification = await this.service.notify(id);
    return ApiResponse.created(notification, 'Notification sent successfully.');
  }
}
