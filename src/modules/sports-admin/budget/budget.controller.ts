import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { BudgetService } from './budget.service';
import { CreateBudgetRequestDto } from './dto/create-budget-request.dto';
import { SearchBudgetRequestsDto } from './dto/search-budget-requests.dto';

/**
 * Sports budget requests.
 *
 * Sports raises the request; **Finance decides it**. The approve/reject
 * routes below are therefore granted to Finance only — Sports approving its
 * own spending was the defect, not a missing button.
 */
@Controller('sports-admin/budget-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN, ROLES.FINANCE)
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Get()
  findAll(@Query() query: SearchBudgetRequestsDto) {
    return this.budgetService.findAll(query);
  }

  /** Raising a request stays with Sports. */
  @Post()
  @Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
  create(@Body() dto: CreateBudgetRequestDto, @CurrentUser() user: JwtPayload) {
    return this.budgetService.create(dto, user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.budgetService.findOne(id);
  }

  /**
   * Decided by Finance. A method-level @Roles overrides the class-level list,
   * so Sports cannot reach these two routes at all.
   */
  @Post(':id/approve')
  @Roles(ROLES.FINANCE, ROLES.ADMIN)
  approve(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.budgetService.approve(id, user.sub);
  }

  @Post(':id/reject')
  @Roles(ROLES.FINANCE, ROLES.ADMIN)
  reject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.budgetService.reject(id, user.sub);
  }
}
