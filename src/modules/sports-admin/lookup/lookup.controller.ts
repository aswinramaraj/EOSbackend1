import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { SportsLookupService } from './lookup.service';

@Controller('sports-admin/lookup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class SportsLookupController {
  constructor(private readonly lookupService: SportsLookupService) {}

  @Get('students')
  searchStudents(@Query('q') q: string) {
    return this.lookupService.searchStudents(q ?? '');
  }

  @Get('faculty')
  searchFaculty(@Query('q') q: string) {
    return this.lookupService.searchFaculty(q ?? '');
  }
}
