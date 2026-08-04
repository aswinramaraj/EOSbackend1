import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MarksheetsService } from './marksheets.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { ApiResponse } from 'src/common/dto/api-response.dto';

@Controller('exams/:id/marksheets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class MarksheetsController {
  constructor(private readonly marksheetsService: MarksheetsService) {}

  @Post(':studentId')
  @HttpCode(HttpStatus.CREATED)
  async generate(
    @Param('id', ParseIntPipe) examId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    const marksheet = await this.marksheetsService.generate(examId, studentId);
    return ApiResponse.created(marksheet, 'Marksheet generated successfully');
  }

  @Get(':studentId')
  findOne(
    @Param('id', ParseIntPipe) examId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.marksheetsService.findOne(examId, studentId);
  }
}
