import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
  @Roles(ROLES.ACADEMIC_COORDINATOR, ROLES.PRINCIPAL)
  create(
    @Body() createAcademicCalendarDto: CreateAcademicCalendarDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.academicCalendarService.create(
      createAcademicCalendarDto,
      user.sub,
    );
  }

  /**
   * GET /academic-calendar?batch_id=&semester=
   * Both filters are optional and independent - used by the Principal's
   * batch/semester picker to find the one calendar it's managing without
   * fetching every calendar institution-wide.
   */
  @Get()
  findAll(
    @Query('batch_id', new ParseIntPipe({ optional: true })) batchId?: number,
    @Query('semester', new ParseIntPipe({ optional: true })) semester?: number,
  ) {
    return this.academicCalendarService.findAll({ batchId, semester });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.academicCalendarService.findOne(+id);
  }

  @Patch(':id')
  @Roles(ROLES.ACADEMIC_COORDINATOR, ROLES.PRINCIPAL)
  update(
    @Param('id') id: string,
    @Body() updateAcademicCalendarDto: UpdateAcademicCalendarDto,
  ) {
    return this.academicCalendarService.update(+id, updateAcademicCalendarDto);
  }

  @Delete(':id')
  @Roles(ROLES.ACADEMIC_COORDINATOR, ROLES.PRINCIPAL)
  remove(@Param('id') id: string) {
    return this.academicCalendarService.remove(+id);
  }
}
