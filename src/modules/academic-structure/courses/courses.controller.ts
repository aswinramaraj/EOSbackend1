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
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  /**
   * POST /api/v1/courses
   * Admin only — creates a new course under an existing department.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  async create(@Body() createCourseDto: CreateCourseDto) {
    const course = await this.coursesService.create(createCourseDto);
    return ApiResponse.created(course, 'Course created successfully');
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.coursesService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.coursesService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  update(@Param('id') id: string, @Body() updateCourseDto: UpdateCourseDto) {
    return this.coursesService.update(+id, updateCourseDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  remove(@Param('id') id: string) {
    return this.coursesService.remove(+id);
  }
}
