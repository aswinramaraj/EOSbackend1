import { Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { StudentTodosService } from './student-todos.service';

/** A student's own view of Placement Cell's broadcast to-dos - see placement-todos.controller.ts for the posting side. */
@Controller('me/todos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.STUDENT)
export class MeTodosController {
  constructor(private readonly todosService: StudentTodosService) {}

  /** GET /api/v1/me/todos */
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.todosService.listMyTodos(user.sub);
  }

  /** POST /api/v1/me/todos/:id/complete */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.todosService.markTodoComplete(user.sub, id);
  }
}
