import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';
import { StudentExamRecordService } from './student-exam-record.service';

class ListStudentExamRecordQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  semester?: number;

  @IsOptional()
  @IsString()
  search?: string;
}

@Controller('student-exam-record')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class StudentExamRecordController {
  constructor(private readonly service: StudentExamRecordService) {}

  @Get()
  async list(@Query() query: ListStudentExamRecordQueryDto) {
    const students = await this.service.list(query);
    return ApiResponse.ok(students, 'Students fetched successfully.');
  }

  @Get(':studentId')
  async getRecord(@Param('studentId', ParseIntPipe) studentId: number) {
    const record = await this.service.getRecord(studentId);
    return ApiResponse.ok(record, 'Student exam record fetched successfully.');
  }
}
