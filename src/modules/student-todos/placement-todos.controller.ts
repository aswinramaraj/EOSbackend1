import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { StudentTodosService } from './student-todos.service';
import { CreateTodoDto } from './dto/create-todo.dto';

/** Placement Cell posting to-dos that every student sees - see me-todos.controller.ts for the student side. */
@Controller('placement/todos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PLACEMENT, ROLES.ADMIN)
export class PlacementTodosController {
  constructor(private readonly todosService: StudentTodosService) {}

  /** GET /api/v1/placement/todos */
  @Get()
  findMine(@CurrentUser() user: JwtPayload) {
    return this.todosService.listMyPostedTodos(user.sub);
  }

  /** POST /api/v1/placement/todos */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTodoDto, @CurrentUser() user: JwtPayload) {
    return this.todosService.createTodo(user.sub, dto);
  }
}
