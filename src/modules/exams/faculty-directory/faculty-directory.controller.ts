import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';
import { FacultyDirectoryService } from './faculty-directory.service';
import { ListFacultyDirectoryQueryDto } from './dto/list-faculty-directory-query.dto';

/**
 * Read-only, cross-department faculty lookup for the COE module — new
 * module, existing `faculty` table. Nothing here writes to faculty data or
 * touches any other module's routes.
 */
@Controller('exam-faculty-directory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class FacultyDirectoryController {
  constructor(private readonly facultyDirectoryService: FacultyDirectoryService) {}

  @Get()
  async findAll(@Query() query: ListFacultyDirectoryQueryDto) {
    const faculty = await this.facultyDirectoryService.findAll(query);
    return ApiResponse.ok(faculty, 'Faculty directory fetched successfully.');
  }
}
