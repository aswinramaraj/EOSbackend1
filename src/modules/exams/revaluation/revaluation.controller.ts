// revaluation.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RevaluationService } from './revaluation.service';
import { CreateRevaluationDto } from './dto/create-revaluation.dto';
import { UpdateRevaluationDto } from './dto/update-revaluation.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';

@Controller()
export class RevaluationController {
  constructor(private readonly revaluationService: RevaluationService) {}

  // Students apply through their own portal; COE also creates these directly
  // for offline/counter applications (the "New application" action on the
  // Revaluation & Retotaling page).
  @Post('revaluation-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT, ROLES.COE)
  async create(@Body() createRevaluationDto: CreateRevaluationDto) {
    const request = await this.revaluationService.create(createRevaluationDto);
    return ApiResponse.created(
      request,
      'Revaluation request created successfully.',
    );
  }

  @Get('revaluation-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async findAll(@Query('status') status?: string) {
    const requests = await this.revaluationService.findAll(status);
    return ApiResponse.ok(
      requests,
      'Revaluation requests fetched successfully.',
    );
  }

  @Get('revaluation-requests/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async findOne(@Param('id') id: string) {
    const request = await this.revaluationService.findOne(+id);
    return ApiResponse.ok(request, 'Revaluation request fetched successfully.');
  }

  @Patch('revaluation-requests/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async update(
    @Param('id') id: string,
    @Body() updateRevaluationDto: UpdateRevaluationDto,
  ) {
    const request = await this.revaluationService.update(
      +id,
      updateRevaluationDto,
    );
    return ApiResponse.ok(request, 'Revaluation request updated successfully.');
  }

  @Delete('revaluation-requests/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async remove(@Param('id') id: string) {
    const result = await this.revaluationService.remove(+id);
    return ApiResponse.ok(result, 'Revaluation request deleted successfully.');
  }

  @Post('revaluation-requests/:id/remind')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async remind(@Param('id') id: string) {
    const notification = await this.revaluationService.remind(+id);
    return ApiResponse.created(notification, 'Reminder sent successfully.');
  }

  @Post('exams/:id/results/publish-revaluation')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async publishRevaluation(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.revaluationService.publishRevaluation(
      +id,
      user.sub,
    );
    return ApiResponse.created(
      result,
      'Revaluation results published successfully.',
    );
  }
}
