import { Test, TestingModule } from '@nestjs/testing';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import request from 'supertest';
import { AlumniModule } from './alumni.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { globalValidationPipe } from 'src/common/pipes/validation.pipe';
import { HttpExceptionFilter } from 'src/common/filters/http-exception.filter';
import { TransformInterceptor } from 'src/common/interceptors/transform.interceptor';

/**
 * Integration tests driven through real HTTP (supertest) against the real
 * AlumniModule wiring — real RolesGuard, real controllers, real services,
 * real global ValidationPipe/HttpExceptionFilter. Only two things are
 * substituted:
 *
 *  - PrismaService is mocked. This repo's DATABASE_URL points at a live,
 *    shared Supabase Postgres instance (confirmed in .env) — there is no
 *    disposable local test database to run against, and every existing unit
 *    spec in this codebase mocks PrismaService rather than hit it. Doing the
 *    same here keeps this test from ever touching real data.
 *  - JwtAuthGuard is replaced with a stand-in that reads the "logged in as"
 *    user from an `x-test-user` header instead of verifying a real bearer
 *    token — token signing/verification is already covered elsewhere; what
 *    this suite exercises is RolesGuard + the isolation logic in the
 *    services, which is the point of these specific tests.
 */
class HeaderUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const raw = req.headers['x-test-user'];
    req.user = raw ? JSON.parse(raw) : undefined;
    return true;
  }
}

function asUser(sub: number, role: string) {
  return JSON.stringify({ sub, email: `u${sub}@eos.test`, role, roleId: 1 });
}

describe('Alumni module (integration)', () => {
  let app: INestApplication;
  let mockPrisma: any;

  // Batch A: alumni_members #1 (student 10, user 501). Batch B: alumni_members #2 (student 20, user 502).
  const STUDENT_A = { id: 10, user_id: 501 };
  const MEMBER_A = { id: 1, alumni_batch_id: 100, student_id: 10 };
  const STUDENT_B = { id: 20, user_id: 502 };
  const MEMBER_B = { id: 2, alumni_batch_id: 200, student_id: 20 };

  beforeAll(async () => {
    mockPrisma = {
      students: { findUnique: jest.fn() },
      alumni_members: { findUnique: jest.fn(), update: jest.fn() },
      alumni_batches: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      alumni_group_messages: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      alumni_announcements: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
      batches: { findMany: jest.fn() },
      $transaction: jest.fn((cb: (tx: any) => unknown) => cb(mockPrisma)),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AlumniModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderUserGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(globalValidationPipe);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Non-alumni is blocked from every /me/alumni/* route ─────────────────

  describe('a student (not yet graduated) gets 403 on every /me/alumni/* route', () => {
    const studentHeader = asUser(999, 'student');

    it('GET /me/alumni/group', async () => {
      const res = await request(app.getHttpServer())
        .get('/me/alumni/group')
        .set('x-test-user', studentHeader);
      expect(res.status).toBe(403);
      expect(mockPrisma.students.findUnique).not.toHaveBeenCalled();
    });

    it('PUT /me/alumni/profile', async () => {
      const res = await request(app.getHttpServer())
        .put('/me/alumni/profile')
        .set('x-test-user', studentHeader)
        .send({ current_company: 'Acme' });
      expect(res.status).toBe(403);
    });

    it('GET /me/alumni/group/messages', async () => {
      const res = await request(app.getHttpServer())
        .get('/me/alumni/group/messages')
        .set('x-test-user', studentHeader);
      expect(res.status).toBe(403);
    });

    it('POST /me/alumni/group/messages', async () => {
      const res = await request(app.getHttpServer())
        .post('/me/alumni/group/messages')
        .set('x-test-user', studentHeader)
        .send({ content: 'hi' });
      expect(res.status).toBe(403);
    });

    it('DELETE /me/alumni/group/messages/:id', async () => {
      const res = await request(app.getHttpServer())
        .delete('/me/alumni/group/messages/1')
        .set('x-test-user', studentHeader);
      expect(res.status).toBe(403);
    });

    it('GET /me/alumni/announcements', async () => {
      const res = await request(app.getHttpServer())
        .get('/me/alumni/announcements')
        .set('x-test-user', studentHeader);
      expect(res.status).toBe(403);
    });
  });

  // ─── Batch isolation on group messages ────────────────────────────────────

  describe('batch isolation on group messages', () => {
    it("blocks a batch-A alumnus from deleting batch-B's message, even knowing its id", async () => {
      mockPrisma.students.findUnique.mockResolvedValue(STUDENT_A);
      mockPrisma.alumni_members.findUnique.mockResolvedValue(MEMBER_A);
      mockPrisma.alumni_group_messages.findUnique.mockResolvedValue({
        id: 500,
        alumni_batch_id: 200, // batch B's message
        posted_by_alumni_member_id: MEMBER_B.id,
      });

      const res = await request(app.getHttpServer())
        .delete('/me/alumni/group/messages/500')
        .set('x-test-user', asUser(STUDENT_A.user_id, 'alumni'));

      expect(res.status).toBe(403);
      expect(mockPrisma.alumni_group_messages.delete).not.toHaveBeenCalled();
    });

    it("blocks deleting a same-batch member's message you don't own — 403", async () => {
      mockPrisma.students.findUnique.mockResolvedValue(STUDENT_A);
      mockPrisma.alumni_members.findUnique.mockResolvedValue(MEMBER_A);
      mockPrisma.alumni_group_messages.findUnique.mockResolvedValue({
        id: 501,
        alumni_batch_id: 100, // same batch as MEMBER_A
        posted_by_alumni_member_id: 77, // a different member
      });

      const res = await request(app.getHttpServer())
        .delete('/me/alumni/group/messages/501')
        .set('x-test-user', asUser(STUDENT_A.user_id, 'alumni'));

      expect(res.status).toBe(403);
      expect(mockPrisma.alumni_group_messages.delete).not.toHaveBeenCalled();
    });

    it('404s deleting a message that does not exist', async () => {
      mockPrisma.students.findUnique.mockResolvedValue(STUDENT_A);
      mockPrisma.alumni_members.findUnique.mockResolvedValue(MEMBER_A);
      mockPrisma.alumni_group_messages.findUnique.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .delete('/me/alumni/group/messages/999999')
        .set('x-test-user', asUser(STUDENT_A.user_id, 'alumni'));

      expect(res.status).toBe(404);
    });

    it('allows deleting your own message', async () => {
      mockPrisma.students.findUnique.mockResolvedValue(STUDENT_A);
      mockPrisma.alumni_members.findUnique.mockResolvedValue(MEMBER_A);
      mockPrisma.alumni_group_messages.findUnique.mockResolvedValue({
        id: 502,
        alumni_batch_id: 100,
        posted_by_alumni_member_id: MEMBER_A.id,
      });
      mockPrisma.alumni_group_messages.delete.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .delete('/me/alumni/group/messages/502')
        .set('x-test-user', asUser(STUDENT_A.user_id, 'alumni'));

      expect(res.status).toBe(200);
      expect(mockPrisma.alumni_group_messages.delete).toHaveBeenCalledWith({
        where: { id: 502 },
      });
    });

    it("posting a message always lands in the caller's own batch — the DTO has no batch field to target another one with", async () => {
      mockPrisma.students.findUnique.mockResolvedValue(STUDENT_B);
      mockPrisma.alumni_members.findUnique.mockResolvedValue(MEMBER_B);
      mockPrisma.alumni_group_messages.create.mockResolvedValue({ id: 1 });

      const res = await request(app.getHttpServer())
        .post('/me/alumni/group/messages')
        .set('x-test-user', asUser(STUDENT_B.user_id, 'alumni'))
        .send({ content: 'hello from B' });

      expect(res.status).toBe(201);
      expect(mockPrisma.alumni_group_messages.create).toHaveBeenCalledWith({
        data: {
          alumni_batch_id: 200, // MEMBER_B's own resolved batch
          posted_by_alumni_member_id: MEMBER_B.id,
          content: 'hello from B',
          attachment_url: undefined,
        },
      });
    });

    it('rejects with 400 (not silently stripped) if a client tries to smuggle a batch id into the body', async () => {
      const res = await request(app.getHttpServer())
        .post('/me/alumni/group/messages')
        .set('x-test-user', asUser(STUDENT_B.user_id, 'alumni'))
        .send({ content: 'hello from B', alumni_batch_id: 100 });

      // forbidNonWhitelisted:true — unknown properties fail the whole
      // request rather than being quietly dropped.
      expect(res.status).toBe(400);
      expect(mockPrisma.alumni_group_messages.create).not.toHaveBeenCalled();
    });
  });

  // ─── Admin announcements are visible to alumni of every batch ─────────────

  describe('admin announcements reach alumni of every batch', () => {
    it("an announcement posted by admin appears in both a batch-A and a batch-B alumnus's feed", async () => {
      mockPrisma.alumni_announcements.create.mockResolvedValue({
        id: 1,
        title: 'Reunion 2026',
        content: 'Join us!',
      });

      const createRes = await request(app.getHttpServer())
        .post('/admin/alumni-announcements')
        .set('x-test-user', asUser(1, 'admin'))
        .send({ title: 'Reunion 2026', content: 'Join us!' });
      expect(createRes.status).toBe(201);

      const feed = [
        {
          id: 1,
          title: 'Reunion 2026',
          content: 'Join us!',
          created_at: new Date(),
        },
      ];
      mockPrisma.alumni_announcements.findMany.mockResolvedValue(feed);
      mockPrisma.alumni_announcements.count.mockResolvedValue(1);

      const asBatchA = await request(app.getHttpServer())
        .get('/me/alumni/announcements')
        .set('x-test-user', asUser(STUDENT_A.user_id, 'alumni'));
      const asBatchB = await request(app.getHttpServer())
        .get('/me/alumni/announcements')
        .set('x-test-user', asUser(STUDENT_B.user_id, 'alumni'));

      expect(asBatchA.status).toBe(200);
      expect(asBatchB.status).toBe(200);
      expect(asBatchA.body.data.data[0]).toMatchObject({
        title: 'Reunion 2026',
      });
      expect(asBatchB.body.data.data[0]).toMatchObject({
        title: 'Reunion 2026',
      });
    });

    it('a non-admin alumnus cannot post an announcement', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/alumni-announcements')
        .set('x-test-user', asUser(STUDENT_A.user_id, 'alumni'))
        .send({ title: 'Not allowed', content: 'x' });

      expect(res.status).toBe(403);
      expect(mockPrisma.alumni_announcements.create).not.toHaveBeenCalled();
    });
  });
});
