import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseIntPipe,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { StudentLeavesService } from './student-leaves.service';
import { CreateStudentLeafDto } from './dto/create-student-leaf.dto';
import { UpdateStudentLeafDto } from './dto/update-student-leaf.dto';
import { ListStudentLeaveQueryDto } from './dto/list-student-leave-query.dto';
import { FacultyApproveLeaveDto } from './dto/faculty-approve-leave.dto';
import { HodApproveLeaveDto } from './dto/hod-approve-leave.dto';

@Controller('me')
export class StudentLeavesController {
  constructor(private readonly studentLeavesService: StudentLeavesService) {}

  @Post('student-leaves')
  create(@Body() createStudentLeafDto: CreateStudentLeafDto) {
    return this.studentLeavesService.create(createStudentLeafDto);
  }

  /**
   * GET /api/v1/me/student-leaves — Faculty (mentor's review queue) or
   * HoD (own-department queue, faculty_approved/hod_approved/rejected only).
   */
  @Get('student-leaves')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.FACULTY, ROLES.HOD)
  findAll(
    @Query() query: ListStudentLeaveQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentLeavesService.findAll(query, user);
  }

  @Get('student-leaves/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.FACULTY, ROLES.HOD)
  findOne(@Param('id') id: string) {
    return this.studentLeavesService.findOne(+id);
  }

  @Patch('student-leaves/:id')
  update(
    @Param('id') id: string,
    @Body() updateStudentLeafDto: UpdateStudentLeafDto,
  ) {
    return this.studentLeavesService.update(+id, updateStudentLeafDto);
  }

  /**
   * PATCH /api/v1/me/student-leaves/:id/faculty-approve — Faculty only (the
   * student's assigned mentor). First stage of the two-stage approval chain.
   */
  @Patch('student-leaves/:id/faculty-approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.FACULTY)
  facultyApprove(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FacultyApproveLeaveDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentLeavesService.facultyApprove(id, dto, user.sub);
  }

  /**
   * PATCH /api/v1/me/student-leaves/:id/hod-approve — HoD only. Second (final)
   * stage of the two-stage approval chain.
   */
  @Patch('student-leaves/:id/hod-approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.HOD)
  hodApprove(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HodApproveLeaveDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentLeavesService.hodApprove(id, dto, user.sub);
  }

  @Delete('student-leaves/:id')
  remove(@Param('id') id: string) {
    return this.studentLeavesService.remove(+id);
  }
}
