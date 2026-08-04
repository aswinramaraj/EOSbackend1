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
  Query,
  UseGuards,
} from '@nestjs/common';
import { SeatingArrangementsService } from './seating-arrangements.service';
import { ExamDateDto } from './dto/exam-date.dto';
import { UpdateSeatingArrangementDto } from './dto/update-seating-arrangement.dto';
import { FindSeatingArrangementsQueryDto } from './dto/find-seating-arrangements-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { ApiResponse } from 'src/common/dto/api-response.dto';

@Controller('seating-arrangements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class SeatingArrangementsController {
  constructor(
    private readonly seatingArrangementsService: SeatingArrangementsService,
  ) {}

  @Post('allocate')
  @HttpCode(HttpStatus.CREATED)
  async allocate(@Body() dto: ExamDateDto) {
    const seating = await this.seatingArrangementsService.allocate(dto);
    return ApiResponse.created(seating, 'Seating allocated successfully');
  }

  @Delete('clear')
  async clear(@Query() dto: ExamDateDto) {
    const result = await this.seatingArrangementsService.clearForExamDate(
      dto.exam_id,
      dto.exam_date,
    );
    return ApiResponse.ok(result, 'Seating cleared successfully');
  }

  @Get('hall-plan/:hallPlanId')
  findByHallPlan(@Param('hallPlanId', ParseIntPipe) hallPlanId: number) {
    return this.seatingArrangementsService.findByHallPlan(hallPlanId);
  }

  @Get('exam/:examId/student/:studentId')
  findForStudent(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.seatingArrangementsService.findForStudent(examId, studentId);
  }

  @Get()
  findAll(@Query() query: FindSeatingArrangementsQueryDto) {
    return this.seatingArrangementsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.seatingArrangementsService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSeatingArrangementDto,
  ) {
    const seating = await this.seatingArrangementsService.update(id, dto);
    return ApiResponse.ok(seating, 'Seating arrangement updated successfully');
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.seatingArrangementsService.remove(id);
    return ApiResponse.ok(null, 'Seating arrangement removed successfully');
  }
}
