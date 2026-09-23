import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { STORAGE_BUCKETS } from 'src/common/constants/storage-buckets.constant';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';

type PlacementTodoRow = {
  id: number;
  title: string;
  description: string | null;
  deadline: Date | null;
  is_active: boolean;
  created_at: Date;
  pdf_url: string | null;
  link_url: string | null;
};

type PlacementTodoWithCountRow = PlacementTodoRow & { completed_count: bigint };

type MyTodoRow = PlacementTodoRow & { completed_at: Date | null };

const PDF_MIME_TYPES = ['application/pdf'];
const PDF_MAX_BYTES = 10 * 1024 * 1024; // 10MB

// placement_todos / student_todo_completions ARE real schema.prisma models
// (see schema.prisma) but every query here is still raw SQL via
// PrismaService's $queryRaw/$executeRaw, matching how this module was
// originally written - same pattern as StationaryService.
//
// "Students who opted placement" = students.career_path = 'placement' (set
// by Placement staff on the Students page, see DrivesService.setStudentCareerPath).
// Every to-do posted here is scoped to that group only, not a broadcast to
// all students - a career_path filter joins in on both the student-facing
// list and the admin's own completion-count denominator.
@Injectable()
export class StudentTodosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ============================================================
  // PLACEMENT / ADMIN
  // ============================================================

  /** POST /placement/todos — broadcasts a new to-do to every student with career_path='placement'. */
  async createTodo(userId: number, dto: CreateTodoDto) {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      INSERT INTO placement_todos (title, description, deadline, created_by_user_id, pdf_url, link_url)
      VALUES (
        ${dto.title},
        ${dto.description ?? null},
        ${dto.deadline ? new Date(dto.deadline) : null},
        ${userId},
        ${dto.pdfUrl ?? null},
        ${dto.linkUrl ?? null}
      )
      RETURNING id
    `;
    return { id: rows[0].id };
  }

  /**
   * POST /placement/todos/pdf-upload - standalone upload, not tied to a
   * to-do id yet (the composer form needs to show/attach a PDF before the
   * to-do itself is created). Returns a public pdf_url the caller then
   * passes straight through createTodo's own pdfUrl field.
   */
  async uploadTodoPdf(file: Express.Multer.File) {
    if (!PDF_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        message: `That file type is not accepted. PDF only - got ${file.mimetype || 'an unknown type'}.`,
        errorCode: 'INVALID_FILE_TYPE',
      });
    }
    if (file.size > PDF_MAX_BYTES) {
      throw new BadRequestException({
        message: `File is too large - the limit is ${PDF_MAX_BYTES / (1024 * 1024)}MB.`,
        errorCode: 'FILE_TOO_LARGE',
      });
    }
    const { key } = await this.storage.upload(
      'placement-todos',
      file.originalname,
      file.buffer,
      file.mimetype,
      STORAGE_BUCKETS.PLACEMENT_TODO_ATTACHMENTS,
    );
    return { pdf_url: this.storage.getPublicUrl(key, STORAGE_BUCKETS.PLACEMENT_TODO_ATTACHMENTS) };
  }

  /**
   * GET /placement/todos — the caller's own posted to-dos, each with how
   * many opted-in (career_path='placement') students have marked it done.
   */
  async listMyPostedTodos(userId: number) {
    const [todos, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<PlacementTodoWithCountRow[]>`
        SELECT t.id, t.title, t.description, t.deadline, t.is_active, t.created_at, t.pdf_url, t.link_url,
               COUNT(c.id) AS completed_count
        FROM placement_todos t
        LEFT JOIN student_todo_completions c ON c.todo_id = t.id
        WHERE t.created_by_user_id = ${userId}
        GROUP BY t.id
        ORDER BY t.created_at DESC
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM students WHERE career_path = 'placement'
      `,
    ]);
    return todos.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      deadline: t.deadline,
      is_active: t.is_active,
      created_at: t.created_at,
      pdf_url: t.pdf_url,
      link_url: t.link_url,
      completed_count: Number(t.completed_count),
      total_students: Number(total),
    }));
  }

  // ============================================================
  // STUDENT
  // ============================================================

  /**
   * GET /me/todos — every active to-do, with the caller's own completion.
   * Returns nothing for a student whose career_path isn't 'placement' -
   * these to-dos are Placement Cell-only, not a general broadcast.
   */
  async listMyTodos(userId: number) {
    const student = await this.resolveStudentByUserId(userId);
    if (student.career_path !== 'placement') {
      return [];
    }
    const rows = await this.prisma.$queryRaw<MyTodoRow[]>`
      SELECT t.id, t.title, t.description, t.deadline, t.is_active, t.created_at, t.pdf_url, t.link_url, c.completed_at
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
      pdf_url: r.pdf_url,
      link_url: r.link_url,
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

  /** PATCH /placement/todos/:id — only the fields present in the body change; only the poster's own to-dos. */
  async updateTodo(userId: number, todoId: number, dto: UpdateTodoDto) {
    const sets: Prisma.Sql[] = [];
    if (dto.title !== undefined) sets.push(Prisma.sql`title = ${dto.title}`);
    if (dto.description !== undefined) sets.push(Prisma.sql`description = ${dto.description || null}`);
    if (dto.deadline !== undefined) sets.push(Prisma.sql`deadline = ${dto.deadline ? new Date(dto.deadline) : null}`);
    if (dto.pdfUrl !== undefined) sets.push(Prisma.sql`pdf_url = ${dto.pdfUrl || null}`);
    if (dto.linkUrl !== undefined) sets.push(Prisma.sql`link_url = ${dto.linkUrl || null}`);

    if (sets.length === 0) {
      return { id: todoId };
    }

    const rows = await this.prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`
        UPDATE placement_todos
        SET ${Prisma.join(sets, ', ')}
        WHERE id = ${todoId} AND created_by_user_id = ${userId}
        RETURNING id
      `,
    );
    if (!rows[0]) {
      throw new NotFoundException({ message: 'To-do not found', errorCode: 'TODO_NOT_FOUND' });
    }
    return { id: todoId };
  }

  /** DELETE /placement/todos/:id — soft delete (is_active=false); only the poster's own to-dos. */
  async deactivateTodo(userId: number, todoId: number) {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      UPDATE placement_todos
      SET is_active = false
      WHERE id = ${todoId} AND created_by_user_id = ${userId}
      RETURNING id
    `;
    if (!rows[0]) {
      throw new NotFoundException({ message: 'To-do not found', errorCode: 'TODO_NOT_FOUND' });
    }
    return { id: todoId };
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
