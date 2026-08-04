import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { CreateEResourceDto } from './dto/create-e-resource.dto';
import { UpdateEResourceDto } from './dto/update-e-resource.dto';
import { SearchEResourcesDto } from './dto/search-e-resources.dto';

// Minimum trigram/word similarity score for a row to count as a fuzzy match.
const FUZZY_SIMILARITY_THRESHOLD = 0.2;

interface EResourceFuzzySearchRow {
  id: number;
  title: string;
  url: string;
  category_id: number | null;
  category_name: string | null;
  format: string | null;
  file_size_bytes: number | null;
  pages: number | null;
  license_type: string | null;
  concurrent_seats: number | null;
  publish_state: string;
  created_at: Date;
  similarity: number;
}

function formatEResource(resource: {
  id: number;
  title: string;
  url: string;
  category_id: number | null;
  format: string | null;
  file_size_bytes: number | null;
  pages: number | null;
  license_type: string | null;
  concurrent_seats: number | null;
  publish_state: string;
  uploaded_by_user_id: number | null;
  created_at: Date;
  book_categories: { id: number; name: string } | null;
}) {
  return {
    id: resource.id,
    title: resource.title,
    url: resource.url,
    category_id: resource.category_id,
    category_name: resource.book_categories?.name ?? null,
    format: resource.format,
    file_size_bytes: resource.file_size_bytes,
    pages: resource.pages,
    license_type: resource.license_type,
    concurrent_seats: resource.concurrent_seats,
    publish_state: resource.publish_state,
    uploaded_by_user_id: resource.uploaded_by_user_id,
    created_at: resource.created_at,
  };
}

@Injectable()
export class EResourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEResourceDto, uploadedByUserId: number) {
    const url = dto.url.trim();

    if (dto.category_id) {
      const category = await this.prisma.book_categories.findUnique({
        where: { id: dto.category_id },
      });

      if (!category) {
        throw new NotFoundException('Book category not found.');
      }
    }

    const existing = await this.prisma.e_resources.findFirst({
      where: { url: { equals: url, mode: 'insensitive' } },
    });

    if (existing) {
      throw new ConflictException(
        'An e-resource with this URL already exists.',
      );
    }

    const resource = await this.prisma.e_resources.create({
      data: {
        title: dto.title,
        url,
        category_id: dto.category_id,
        format: dto.format,
        file_size_bytes: dto.file_size_bytes,
        pages: dto.pages,
        license_type: dto.license_type,
        concurrent_seats: dto.concurrent_seats,
        publish_state: dto.publish_state,
        uploaded_by_user_id: uploadedByUserId,
      },
      include: {
        book_categories: {
          select: { id: true, name: true },
        },
      },
    });

    return formatEResource(resource);
  }

  async findAll(searchDto: SearchEResourcesDto) {
    const {
      q,
      category_id,
      format,
      publish_state,
      page = 1,
      page_size = 20,
    } = searchDto;

    const where: Prisma.e_resourcesWhereInput = {};

    if (q) {
      where.title = { contains: q, mode: 'insensitive' };
    }

    if (category_id) {
      where.category_id = category_id;
    }

    if (format) {
      where.format = format;
    }

    if (publish_state) {
      where.publish_state = publish_state;
    }

    const [resources, total] = await this.prisma.$transaction([
      this.prisma.e_resources.findMany({
        where,
        include: {
          book_categories: {
            select: { id: true, name: true },
          },
        },
        orderBy: { title: 'asc' },
        skip: (page - 1) * page_size,
        take: page_size,
      }),
      this.prisma.e_resources.count({ where }),
    ]);

    return {
      page,
      page_size,
      total,
      data: resources.map(formatEResource),
    };
  }

  /**
   * Typo-tolerant search over title using pg_trgm's similarity() and
   * word_similarity() (see BooksService.searchFuzzy for the rationale).
   */
  async searchFuzzy(query: string, limit = 20) {
    const q = query.trim();
    const cappedLimit = Math.min(limit ?? 20, 20);

    const rows = await this.prisma.$queryRaw<EResourceFuzzySearchRow[]>`
      SELECT
        er.id,
        er.title,
        er.url,
        er.category_id,
        bc.name AS category_name,
        er.format,
        er.file_size_bytes,
        er.pages,
        er.license_type,
        er.concurrent_seats,
        er.publish_state,
        er.created_at,
        GREATEST(
          similarity(er.title, ${q}),
          word_similarity(${q}, er.title)
        ) AS similarity
      FROM e_resources er
      LEFT JOIN book_categories bc ON bc.id = er.category_id
      WHERE
        similarity(er.title, ${q}) > ${FUZZY_SIMILARITY_THRESHOLD}
        OR word_similarity(${q}, er.title) > ${FUZZY_SIMILARITY_THRESHOLD}
      ORDER BY similarity DESC
      LIMIT ${cappedLimit}
    `;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      category_id: row.category_id,
      category_name: row.category_name,
      format: row.format,
      file_size_bytes: row.file_size_bytes,
      pages: row.pages,
      license_type: row.license_type,
      concurrent_seats: row.concurrent_seats,
      publish_state: row.publish_state,
      created_at: row.created_at,
      similarity: Number(row.similarity),
    }));
  }

  async findOne(id: number) {
    const resource = await this.prisma.e_resources.findUnique({
      where: { id },
      include: {
        book_categories: {
          select: { id: true, name: true },
        },
      },
    });

    if (!resource) {
      throw new NotFoundException('E-resource not found.');
    }

    return formatEResource(resource);
  }

  async update(id: number, dto: UpdateEResourceDto) {
    const resource = await this.prisma.e_resources.findUnique({
      where: { id },
    });

    if (!resource) {
      throw new NotFoundException('E-resource not found.');
    }

    if (dto.category_id) {
      const category = await this.prisma.book_categories.findUnique({
        where: { id: dto.category_id },
      });

      if (!category) {
        throw new NotFoundException('Book category not found.');
      }
    }

    const url = dto.url?.trim();

    if (url) {
      const existing = await this.prisma.e_resources.findFirst({
        where: { url: { equals: url, mode: 'insensitive' }, NOT: { id } },
      });

      if (existing) {
        throw new ConflictException(
          'An e-resource with this URL already exists.',
        );
      }
    }

    const updated = await this.prisma.e_resources.update({
      where: { id },
      data: { ...dto, ...(url ? { url } : {}) },
      include: {
        book_categories: {
          select: { id: true, name: true },
        },
      },
    });

    return formatEResource(updated);
  }

  async remove(id: number) {
    const resource = await this.prisma.e_resources.findUnique({
      where: { id },
    });

    if (!resource) {
      throw new NotFoundException('E-resource not found.');
    }

    await this.prisma.e_resources.delete({ where: { id } });

    return { message: 'E-resource deleted successfully.' };
  }
}
