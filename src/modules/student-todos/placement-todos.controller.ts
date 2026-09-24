import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { StudentTodosService } from './student-todos.service';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';

/** Placement Cell posting to-dos to students who opted placement (career_path='placement') - see me-todos.controller.ts for the student side. */
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

  /**
   * POST /api/v1/placement/todos/pdf-upload (multipart, field "file") -
   * standalone, no to-do id required. Returns { pdf_url }; the caller
   * passes that straight into the create call's own pdfUrl field.
   */
  @Post('pdf-upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadPdf(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was uploaded (expected multipart field "file")',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return this.todosService.uploadTodoPdf(file);
  }

  /** PATCH /api/v1/placement/todos/:id */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTodoDto, @CurrentUser() user: JwtPayload) {
    return this.todosService.updateTodo(user.sub, id, dto);
  }

  /** DELETE /api/v1/placement/todos/:id */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.todosService.deactivateTodo(user.sub, id);
  }
}
