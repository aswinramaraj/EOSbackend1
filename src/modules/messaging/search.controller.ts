import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MessagingService } from './messaging.service';
import { SearchPeopleQueryDto } from './dto/search-people-query.dto';

@Controller('me/messaging')
@UseGuards(JwtAuthGuard)
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
}
