import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Resolves the hostel a warden is scoped to, via hostels.warden_user_id.
 * Returns null for admins/other roles with no hostel assignment of their
 * own — callers should treat null as "no forced scope, honour whatever
 * hostel_id (if any) the caller already asked for".
 */
export async function resolveWardenHostelId(
  prisma: PrismaService,
  userId: number,
): Promise<number | null> {
  const hostel = await prisma.hostels.findFirst({
    where: { warden_user_id: userId },
    select: { id: true },
  });
  return hostel?.id ?? null;
}
