import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { OdLettersService } from './od-letters.service';
import { IssueOdLetterNumbersDto } from './dto/issue-od-letter-numbers.dto';

@Controller('sports-admin/od-letters')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class OdLettersController {
  constructor(private readonly odLettersService: OdLettersService) {}

  /** POST /sports-admin/od-letters/issue — one sequential letter number per student_id. */
  @Post('issue')
  @HttpCode(HttpStatus.CREATED)
  issue(@Body() dto: IssueOdLetterNumbersDto, @CurrentUser() user: JwtPayload) {
    return this.odLettersService.issue(dto, user.sub);
  }
}
