import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ClassesService } from './classes.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { MentorQueryDto } from './dto/mentor-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  async create(@Body() createClassDto: CreateClassDto) {
    const classRecord = await this.classesService.create(createClassDto);
    return ApiResponse.created(classRecord, 'Class created successfully');
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.classesService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.classesService.findOne(+id);
  }

  @Get(':id/mentor')
  @UseGuards(JwtAuthGuard)
  findMentor(@Param('id') id: string, @Query() query: MentorQueryDto) {
    return this.classesService.findMentor(+id, query);
  }

  /** GET /api/v1/classes/:id/subjects — read-only, for the class detail panel. */
  @Get(':id/subjects')
  findSubjects(@Param('id') id: string) {
    return this.classesService.subjectsForClass(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  update(@Param('id') id: string, @Body() updateClassDto: UpdateClassDto) {
    return this.classesService.update(+id, updateClassDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  remove(@Param('id') id: string) {
    return this.classesService.remove(+id);
  }
}
