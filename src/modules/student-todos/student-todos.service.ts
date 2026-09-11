import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTodoDto } from './dto/create-todo.dto';

type PlacementTodoRow = {
  id: number;
  title: string;
  description: string | null;
  deadline: Date | null;
  is_active: boolean;
  created_at: Date;
};

type PlacementTodoWithCountRow = PlacementTodoRow & { completed_count: bigint };

type MyTodoRow = PlacementTodoRow & { completed_at: Date | null };

// placement_todos / student_todo_completions are manual-SQL tables (see
// prisma/manual-sql/student_todos.sql) - not schema.prisma models, per this
// project's "never modify schema.prisma for a small additive table"
// convention - so every query here is raw SQL via PrismaService's
// $queryRaw/$executeRaw, same pattern as StationaryService.
@Injectable()
export class StudentTodosService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // PLACEMENT / ADMIN
  // ============================================================

  /** POST /placement/todos — broadcasts a new to-do to every student. */
  async createTodo(userId: number, dto: CreateTodoDto) {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      INSERT INTO placement_todos (title, description, deadline, created_by_user_id)
      VALUES (${dto.title}, ${dto.description ?? null}, ${dto.deadline ? new Date(dto.deadline) : null}, ${userId})
      RETURNING id
    `;
    return { id: rows[0].id };
  }

  /**
   * GET /placement/todos — the caller's own posted to-dos, each with how
   * many students have marked it done (out of every student that exists -
   * this is a broadcast to all students, not scoped to any one class/dept).
   */
  async listMyPostedTodos(userId: number) {
    const [todos, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<PlacementTodoWithCountRow[]>`
        SELECT t.id, t.title, t.description, t.deadline, t.is_active, t.created_at,
               COUNT(c.id) AS completed_count
        FROM placement_todos t
        LEFT JOIN student_todo_completions c ON c.todo_id = t.id
        WHERE t.created_by_user_id = ${userId}
        GROUP BY t.id
        ORDER BY t.created_at DESC
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM students`,
    ]);
    return todos.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      deadline: t.deadline,
      is_active: t.is_active,
      created_at: t.created_at,
      completed_count: Number(t.completed_count),
      total_students: Number(total),
    }));
  }

  // ============================================================
  // STUDENT
  // ============================================================

  /** GET /me/todos — every active to-do, with the caller's own completion. */
  async listMyTodos(userId: number) {
    const student = await this.resolveStudentByUserId(userId);
    const rows = await this.prisma.$queryRaw<MyTodoRow[]>`
      SELECT t.id, t.title, t.description, t.deadline, t.is_active, t.created_at, c.completed_at
      FROM placement_todos t
      LEFT JOIN student_todo_completions c ON c.todo_id = t.id AND c.student_id = ${student.id}
      WHERE t.is_active = true
      ORDER BY t.deadline ASC NULLS LAST, t.created_at DESC
    `;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      deadline: r.deadline,
      is_completed: r.completed_at !== null,
      completed_at: r.completed_at,
    }));
  }

  /** POST /me/todos/:id/complete — idempotent; marking an already-done to-do done again is a no-op. */
  async markTodoComplete(userId: number, todoId: number) {
    const student = await this.resolveStudentByUserId(userId);

    const todoRows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM placement_todos WHERE id = ${todoId} AND is_active = true
    `;
    if (!todoRows[0]) {
      throw new NotFoundException({ message: 'To-do not found', errorCode: 'TODO_NOT_FOUND' });
    }

    await this.prisma.$executeRaw`
      INSERT INTO student_todo_completions (todo_id, student_id)
      VALUES (${todoId}, ${student.id})
      ON CONFLICT (todo_id, student_id) DO NOTHING
    `;
    return { id: todoId, is_completed: true };
  }

  private async resolveStudentByUserId(userId: number) {
    const student = await this.prisma.students.findUnique({ where: { user_id: userId } });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for the authenticated user',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    return student;
  }
}
