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
import { MalpracticeService } from './malpractice.service';
import { CreateMalpracticeDto } from './dto/create-malpractice.dto';
import { UpdateMalpracticeDto } from './dto/update-malpractice.dto';
import { FindMalpracticeQueryDto } from './dto/find-malpractice-query.dto';
import { LookupStudentQueryDto } from './dto/lookup-student-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { ApiResponse } from 'src/common/dto/api-response.dto';

@Controller('malpractice-incidents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class MalpracticeController {
  constructor(private readonly malpracticeService: MalpracticeService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createMalpracticeDto: CreateMalpracticeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const incident = await this.malpracticeService.create(
      createMalpracticeDto,
      user.sub,
    );
    return ApiResponse.created(
      incident,
      'Malpractice incident recorded successfully',
    );
  }

  // Must come before ":id" below so "lookup-student" isn't parsed as an id.
  @Get('lookup-student')
  async lookupStudent(@Query() query: LookupStudentQueryDto) {
    const student = await this.malpracticeService.lookupStudent(query);
    return ApiResponse.ok(student, 'Student found successfully');
  }

  @Get()
  findAll(@Query() query: FindMalpracticeQueryDto) {
    return this.malpracticeService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.malpracticeService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateMalpracticeDto: UpdateMalpracticeDto,
  ) {
    const incident = await this.malpracticeService.update(
      id,
      updateMalpracticeDto,
    );
    return ApiResponse.ok(
      incident,
      'Malpractice incident updated successfully',
    );
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.malpracticeService.remove(id);
    return ApiResponse.ok(null, 'Malpractice incident removed successfully');
  }
}
