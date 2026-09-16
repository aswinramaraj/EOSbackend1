import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { MessagingService } from './messaging.service';
import { SearchPeopleQueryDto } from './dto/search-people-query.dto';

@Controller('me/messaging')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SearchController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('search')
  search(
    @Query() query: SearchPeopleQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.searchPeople(user.sub, user.role, query);
  }

  @Get('contacts/suggested')
  suggested(@CurrentUser() user: JwtPayload) {
    return this.messaging.getSuggestedContacts(user.sub, user.role);
  }

  /** GET /me/messaging/contacts/eligible-students?q= (Faculty/HoD/Student) —
   * any active student in the college, regardless of department/year/
   * section/class/subject (see MessagingService.getEligibleStudents). Used
   * both for Faculty/HoD group creation and student group creation/chat-
   * request selection. Without `q` this returns a capped default page; `q`
   * searches the full student directory by name/roll/register no./email. */
  @Get('contacts/eligible-students')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.STUDENT)
  eligibleStudents(
    @Query() query: SearchPeopleQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.getEligibleStudents(user.sub, query.q);
  }
}
