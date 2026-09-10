require('dotenv').config();
const { PrismaClient } = require('./generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

(async () => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    const books = await prisma.books.findMany({
      where: {
        deleted_at: null,
        OR: [
          { title: { contains: 'engineering', mode: 'insensitive' } },
          { author: { contains: 'engineering', mode: 'insensitive' } },
        ],
      },
      include: {
        book_categories: { select: { id: true, name: true } },
        departments: { select: { id: true, name: true, code: true } },
        library_racks: { select: { id: true, rack_code: true, subject_range: true } },
      },
      orderBy: { title: 'asc' },
      skip: 0,
      take: 20,
    });
    console.log('OK', books.length);
  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
  } finally {
    await prisma.$disconnect();
  }
})();
