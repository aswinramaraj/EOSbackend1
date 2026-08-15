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
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { FacultyMappingService } from './faculty-mapping.service';
import { CreateFacultyMappingDto } from './dto/create-faculty-mapping.dto';
import { UpdateFacultyMappingDto } from './dto/update-faculty-mapping.dto';
import { ListFacultyMappingQueryDto } from './dto/list-faculty-mapping-query.dto';
import { ListMappingSubjectsQueryDto } from './dto/list-mapping-subjects-query.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacultyMappingController {
  constructor(private readonly facultyMappingService: FacultyMappingService) {}

  /** GET /api/v1/me/faculty-mapping/lookup/my-department — HoD only. Header info for the "Assigned Faculty" screen. */
  @Get('faculty-mapping/lookup/my-department')
  @Roles(ROLES.HOD)
  getMyDepartment(@CurrentUser() user: JwtPayload) {
    return this.facultyMappingService.getMyDepartment(user.sub);
  }

  /** GET /api/v1/me/faculty-mapping/lookup/batches — HoD only. Batches in the HoD's own department, for the filter. */
  @Get('faculty-mapping/lookup/batches')
  @Roles(ROLES.HOD)
  getMyDepartmentBatches(@CurrentUser() user: JwtPayload) {
    return this.facultyMappingService.getMyDepartmentBatches(user.sub);
  }

  /** GET /api/v1/me/faculty-mapping/lookup/subjects?batch_id=&search= — HoD only. Every subject in that batch + department, with its current assigned faculty. */
  @Get('faculty-mapping/lookup/subjects')
  @Roles(ROLES.HOD)
  findSubjectsForHod(
    @Query() query: ListMappingSubjectsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyMappingService.findSubjectsForHod(query, user.sub);
  }

  /** POST /api/v1/me/faculty-mapping — HoD only. */
  @Post('faculty-mapping')
  @Roles(ROLES.HOD)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateFacultyMappingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyMappingService.create(dto, user.sub);
  }

  /** GET /api/v1/me/faculty-mapping — Admin/HoD/Faculty. Paginated, optionally filtered. */
  @Get('faculty-mapping')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.FACULTY)
  findAll(@Query() query: ListFacultyMappingQueryDto) {
    return this.facultyMappingService.findAll(query);
  }

  /** GET /api/v1/me/faculty-mapping/:id — Admin/HoD/Faculty. */
  @Get('faculty-mapping/:id')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.FACULTY)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.facultyMappingService.findOne(id);
  }

  /** PATCH /api/v1/me/faculty-mapping/:id — HoD only, own department. */
  @Patch('faculty-mapping/:id')
  @Roles(ROLES.HOD)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFacultyMappingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyMappingService.update(id, dto, user.sub);
  }

  /**
   * DELETE /api/v1/me/faculty-mapping/:id — HoD only, own department.
   * Hard delete (no soft-delete column on this table).
   */
  @Delete('faculty-mapping/:id')
  @Roles(ROLES.HOD)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyMappingService.remove(id, user.sub);
  }
}
