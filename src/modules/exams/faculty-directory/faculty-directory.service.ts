import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListFacultyDirectoryQueryDto } from './dto/list-faculty-directory-query.dto';

function fullName(p: { prefix?: string | null; first_name: string; last_name?: string | null }): string {
  return [p.prefix, p.first_name, p.last_name].filter(Boolean).join(' ');
}

@Injectable()
export class FacultyDirectoryService {
  private readonly logger = new Logger(FacultyDirectoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListFacultyDirectoryQueryDto) {
    try {
      const rows = await this.prisma.faculty.findMany({
        where: {
          status: 'active',
          department_id: query.department_id,
          OR: query.search
            ? [
                { first_name: { contains: query.search, mode: 'insensitive' } },
                { last_name: { contains: query.search, mode: 'insensitive' } },
                { designation: { contains: query.search, mode: 'insensitive' } },
              ]
            : undefined,
        },
        select: {
          id: true,
          prefix: true,
          first_name: true,
          last_name: true,
          designation: true,
          department_id: true,
          departments: { select: { name: true, code: true } },
        },
        orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      });

      return rows.map((f) => ({
        id: f.id,
        name: fullName(f),
        designation: f.designation,
        department_id: f.department_id,
        department_name: f.departments.name,
        department_code: f.departments.code,
      }));
    } catch (err: any) {
      this.logger.error('DB error while fetching faculty directory', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
