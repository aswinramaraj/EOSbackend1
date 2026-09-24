import { PartialType } from '@nestjs/mapped-types';
import { CreateTodoDto } from './create-todo.dto';

/** PATCH /placement/todos/:id */
export class UpdateTodoDto extends PartialType(CreateTodoDto) {}
