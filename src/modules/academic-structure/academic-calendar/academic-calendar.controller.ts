import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AcademicCalendarService } from './academic-calendar.service';
import { CreateAcademicCalendarDto } from './dto/create-academic-calendar.dto';
import { UpdateAcademicCalendarDto } from './dto/update-academic-calendar.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

@Controller('academic-calendar')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcademicCalendarController {
  constructor(
    private readonly academicCalendarService: AcademicCalendarService,
  ) {}

  @Post()
  @Roles(ROLES.ACADEMIC_COORDINATOR)
  create(
    @Body() createAcademicCalendarDto: CreateAcademicCalendarDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.academicCalendarService.create(
      createAcademicCalendarDto,
      user.sub,
    );
  }

  @Get()
  findAll() {
    return this.academicCalendarService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.academicCalendarService.findOne(+id);
  }

  @Patch(':id')
  @Roles(ROLES.ACADEMIC_COORDINATOR)
  update(
    @Param('id') id: string,
    @Body() updateAcademicCalendarDto: UpdateAcademicCalendarDto,
  ) {
    return this.academicCalendarService.update(+id, updateAcademicCalendarDto);
  }

  @Delete(':id')
  @Roles(ROLES.ACADEMIC_COORDINATOR)
  remove(@Param('id') id: string) {
    return this.academicCalendarService.remove(+id);
  }
}
