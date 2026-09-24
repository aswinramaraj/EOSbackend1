// subjects/subjects.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';

@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.ACADEMIC_COORDINATOR)
  async create(
    @Body() createSubjectDto: CreateSubjectDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const subject = await this.subjectsService.create(
      createSubjectDto,
      user.sub,
    );
    return ApiResponse.created(subject, 'Subject created successfully');
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.subjectsService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.subjectsService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.ACADEMIC_COORDINATOR)
  update(
    @Param('id') id: string,
    @Body() updateSubjectDto: UpdateSubjectDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subjectsService.update(+id, updateSubjectDto, user.sub);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.ACADEMIC_COORDINATOR)
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.subjectsService.remove(+id, user.sub);
  }
}
