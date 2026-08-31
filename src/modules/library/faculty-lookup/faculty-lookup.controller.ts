import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { FacultyLookupService } from './faculty-lookup.service';

/**
 * Staff-only faculty lookup for the library circulation desk — lets a book
 * be issued to a faculty borrower, the same way student-lookup already
 * lets one be issued to a student. book_borrow_records already supports a
 * faculty_id borrower end-to-end (schema, DTO, service validation); this
 * endpoint was the missing search path feeding that flow.
 */
@Controller('library/faculty')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('library', 'admin')
export class FacultyLookupController {
  constructor(private readonly facultyLookupService: FacultyLookupService) {}

  @Get('search')
  search(@Query('q') q?: string) {
    return this.facultyLookupService.search(q);
  }
}
