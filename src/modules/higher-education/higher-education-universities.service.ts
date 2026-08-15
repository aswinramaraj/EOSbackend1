import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { CreateUniversityDto } from './dto/create-university.dto';

interface UniversityRegisterRow {
  id: number;
  name: string;
  country: string;
  programmes: string | null;
  applied_count: number;
  admits_count: number;
  funded_count: number;
  relation: string;
}

/**
 * "Universities & partners" for the Higher Education Cell — backed by
 * higher_education_universities, a coordinator-maintained register (new
 * table, not in schema.prisma). Applied/admits/funded are typed-in summary
 * counts, matching how the design's own "Add university" form treats them
 * — plain numbers, not derived from individual aspirant rows. "Relation"
 * (MoU active / Regular / National / Affiliating / New) tracks the cell's
 * institutional relationship, which nothing else in the schema captures.
 */
@Injectable()
export class HigherEducationUniversitiesService {
  private readonly logger = new Logger(HigherEducationUniversitiesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getUniversities() {
    try {
      const rows = await this.prisma.$queryRaw<UniversityRegisterRow[]>(Prisma.sql`
        SELECT id, name, country, programmes, applied_count, admits_count, funded_count, relation
        FROM higher_education_universities
        ORDER BY applied_count DESC, id ASC
      `);

      return {
        summary: {
          universitiesInPlay: rows.length,
          countriesInPlay: new Set(rows.map((r) => r.country)).size,
          totalApplied: rows.reduce((sum, r) => sum + r.applied_count, 0),
          totalAdmits: rows.reduce((sum, r) => sum + r.admits_count, 0),
        },
        universities: rows.map((r) => ({
          id: r.id,
          name: r.name,
          country: r.country,
          programmes: r.programmes,
          applied: r.applied_count,
          admits: r.admits_count,
          funded: r.funded_count,
          relation: r.relation,
        })),
      };
    } catch (err) {
      this.logger.error('DB error building higher-education universities view', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async createUniversity(dto: CreateUniversityDto) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO higher_education_universities (name, country, programmes, applied_count, admits_count, funded_count, relation)
        VALUES (
          ${dto.name},
          ${dto.country},
          ${dto.programmes ?? null},
          ${dto.applied_count ?? 0},
          ${dto.admits_count ?? 0},
          ${dto.funded_count ?? 0},
          ${dto.relation ?? 'new'}
        )
        RETURNING id
      `);
      return { id: rows[0].id };
    } catch (err) {
      this.logger.error('DB error creating university', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
