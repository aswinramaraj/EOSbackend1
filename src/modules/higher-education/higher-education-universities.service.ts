import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { CreateUniversityDto } from './dto/create-university.dto';
import type { UpdateUniversityDto } from './dto/update-university.dto';
import { requireUpdateSet } from './higher-education-sql.util';

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

  /** PATCH /me/higher-education-universities/:id */
  async updateUniversity(id: number, dto: UpdateUniversityDto) {
    const set = requireUpdateSet([
      { column: 'name', value: dto.name },
      { column: 'country', value: dto.country },
      { column: 'programmes', value: dto.programmes },
      { column: 'applied_count', value: dto.applied_count },
      { column: 'admits_count', value: dto.admits_count },
      { column: 'funded_count', value: dto.funded_count },
      { column: 'relation', value: dto.relation },
    ]);

    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE higher_education_universities SET ${set} WHERE id = ${id} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({
          message: 'University not found',
          errorCode: 'UNIVERSITY_NOT_FOUND',
        });
      }
      this.logger.log(`University updated: id=${id}`);
      return { id };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error updating university', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /me/higher-education-universities/:id
   *
   * Aspirants record their target university as free text
   * (student_higher_education.preferred_university), so no foreign key blocks
   * this. Those aspirations are counted first and the delete refused if any
   * exist — otherwise removing the university would quietly orphan them.
   */
  async deleteUniversity(id: number) {
    try {
      const existing = await this.prisma.$queryRaw<{ name: string }[]>(Prisma.sql`
        SELECT name FROM higher_education_universities WHERE id = ${id}
      `);
      if (existing.length === 0) {
        throw new NotFoundException({
          message: 'University not found',
          errorCode: 'UNIVERSITY_NOT_FOUND',
        });
      }

      const aspirants = await this.prisma.student_higher_education.count({
        where: { preferred_university: existing[0].name },
      });
      if (aspirants > 0) {
        throw new ConflictException({
          message: `${aspirants} aspirant(s) still list this university as their preference. Reassign them before deleting it.`,
          errorCode: 'UNIVERSITY_IN_USE',
        });
      }

      await this.prisma.$executeRaw(Prisma.sql`
        DELETE FROM higher_education_universities WHERE id = ${id}
      `);
      this.logger.log(`University deleted: id=${id}`);
      return { id, message: 'University deleted successfully' };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ConflictException) throw err;
      this.logger.error('DB error deleting university', err);
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
