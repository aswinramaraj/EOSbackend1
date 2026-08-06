import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ExamSettingsService } from './exam-settings.service';
import { UpdatePassRulesDto } from './dto/update-pass-rules.dto';
import { CreateGradeBandDto } from './dto/create-grade-band.dto';
import { UpdateGradeBandDto } from './dto/update-grade-band.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ExamSettingsController {
  constructor(private readonly examSettingsService: ExamSettingsService) {}

  @Get('exam-pass-rules')
  async getPassRules() {
    const rules = await this.examSettingsService.getPassRules();
    return ApiResponse.ok(rules, 'Pass rules fetched successfully.');
  }

  @Patch('exam-pass-rules')
  async updatePassRules(@Body() dto: UpdatePassRulesDto) {
    const rules = await this.examSettingsService.updatePassRules(dto);
    return ApiResponse.ok(rules, 'Pass rules updated successfully.');
  }

  @Get('grade-bands')
  async listGradeBands() {
    const bands = await this.examSettingsService.listGradeBands();
    return ApiResponse.ok(bands, 'Grade bands fetched successfully.');
  }

  @Post('grade-bands')
  async createGradeBand(@Body() dto: CreateGradeBandDto) {
    const band = await this.examSettingsService.createGradeBand(dto);
    return ApiResponse.created(band, 'Grade band created successfully.');
  }

  @Patch('grade-bands/:id')
  async updateGradeBand(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGradeBandDto,
  ) {
    const band = await this.examSettingsService.updateGradeBand(id, dto);
    return ApiResponse.ok(band, 'Grade band updated successfully.');
  }

  @Delete('grade-bands/:id')
  async removeGradeBand(@Param('id', ParseIntPipe) id: number) {
    const result = await this.examSettingsService.removeGradeBand(id);
    return ApiResponse.ok(result, 'Grade band deleted successfully.');
  }
}
