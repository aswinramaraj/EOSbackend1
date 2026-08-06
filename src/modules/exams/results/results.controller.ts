// results.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  Patch,
  Delete,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResultsService } from './results.service';
import { UpdateResultDto } from './dto/update-result.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SeniorCoeGuard } from 'src/auth/guards/senior-coe.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';

@Controller()
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Post('exams/:id/results/publish')
  @UseGuards(JwtAuthGuard, RolesGuard, SeniorCoeGuard)
  @Roles(ROLES.COE)
  async publish(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const result = await this.resultsService.publish(+id, user.sub);
    return ApiResponse.created(result, 'Results published successfully.');
  }

  @Get('results')
  async findAll() {
    const results = await this.resultsService.findAll();
    return ApiResponse.ok(results, 'Results fetched successfully.');
  }

  @Get('results/:id')
  async findOne(@Param('id') id: string) {
    const result = await this.resultsService.findOne(+id);
    return ApiResponse.ok(result, 'Result fetched successfully.');
  }

  @Patch('results/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async update(
    @Param('id') id: string,
    @Body() updateResultDto: UpdateResultDto,
  ) {
    const result = await this.resultsService.update(+id, updateResultDto);
    return ApiResponse.ok(result, 'Result updated successfully.');
  }
  // results.controller.ts — add this method (Delete already imported from before)
  @Delete('results/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async remove(@Param('id') id: string) {
    const result = await this.resultsService.remove(+id);
    return ApiResponse.ok(result, 'Result deleted successfully.');
  }

  @Get('exams/:id/results/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async getSummary(@Param('id', ParseIntPipe) id: number) {
    const summary = await this.resultsService.getSummary(id);
    return ApiResponse.ok(summary, 'Results summary fetched successfully.');
  }

  @Get('exams/:id/results/pass-rate-by-department')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async getPassRateByDepartment(@Param('id', ParseIntPipe) id: number) {
    const rates = await this.resultsService.getPassRateByDepartment(id);
    return ApiResponse.ok(
      rates,
      'Pass rate by department fetched successfully.',
    );
  }

  @Get('exams/:id/results/rank-holders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async getRankHolders(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
  ) {
    const rankHolders = await this.resultsService.getRankHolders(
      id,
      limit ? +limit : 5,
    );
    return ApiResponse.ok(rankHolders, 'Rank holders fetched successfully.');
  }
}
