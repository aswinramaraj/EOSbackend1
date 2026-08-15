import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { paginate } from '../../../common/dto/pagination.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { ListCompaniesQueryDto } from './dto/list-companies-query.dto';

interface CompanyExtras {
  industry: string | null;
  location: string | null;
  recruiter_spoc: string | null;
  expected_package_lpa: number | null;
}

const NO_EXTRAS: CompanyExtras = {
  industry: null,
  location: null,
  recruiter_spoc: null,
  expected_package_lpa: null,
};

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `industry`/`location`/`recruiter_spoc`/`expected_package_lpa` are real
   * once query.md #13 runs (`companies` gets the columns) — read/written via
   * `$queryRaw` rather than the typed client since they predate a
   * `prisma db pull`. Every read here degrades to `NO_EXTRAS`, and every
   * write falls back to the base columns only, when the columns don't exist
   * yet — never a thrown error.
   */
  private async loadAllExtras(): Promise<Map<number, CompanyExtras>> {
    try {
      const rows = await this.prisma.$queryRaw<
        ({ id: number } & CompanyExtras)[]
      >`
        SELECT id, industry, location, recruiter_spoc, expected_package_lpa::float8 AS expected_package_lpa
        FROM companies
      `;
      return new Map(rows.map((r) => [r.id, r]));
    } catch {
      return new Map();
    }
  }

  private async loadExtras(id: number): Promise<CompanyExtras> {
    try {
      const rows = await this.prisma.$queryRaw<CompanyExtras[]>`
        SELECT industry, location, recruiter_spoc, expected_package_lpa::float8 AS expected_package_lpa
        FROM companies WHERE id = ${id}
      `;
      return rows[0] ?? NO_EXTRAS;
    } catch {
      return NO_EXTRAS;
    }
  }

  async create(dto: CreateCompanyDto) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>`
        INSERT INTO companies (name, profile_info, industry, location, recruiter_spoc, expected_package_lpa)
        VALUES (${dto.name}, ${dto.profile_info ?? null}, ${dto.industry ?? null}, ${dto.location ?? null}, ${dto.recruiter_spoc ?? null}, ${dto.expected_package_lpa ?? null})
        RETURNING id
      `;
      return this.findOne(rows[0].id);
    } catch {
      const company = await this.prisma.companies.create({
        data: { name: dto.name, profile_info: dto.profile_info },
      });
      return { ...company, ...NO_EXTRAS };
    }
  }

  async findAll(dto: ListCompaniesQueryDto) {
    const where = dto.search
      ? { name: { contains: dto.search, mode: 'insensitive' as const } }
      : {};

    const [data, total, extras] = await Promise.all([
      this.prisma.companies.findMany({
        where,
        skip: dto.skip,
        take: dto.limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.companies.count({ where }),
      this.loadAllExtras(),
    ]);

    return paginate(
      data.map((c) => ({ ...c, ...(extras.get(c.id) ?? NO_EXTRAS) })),
      total,
      dto,
    );
  }

  async findOne(id: number) {
    const company = await this.findOrThrow(id);
    const extras = await this.loadExtras(id);
    return { ...company, ...extras };
  }

  // One row per company with real, computed recruitment stats — powers the
  // Companies page.
  async getCompanyReport() {
    const [companies, extras] = await Promise.all([
      this.prisma.companies.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          profile_info: true,
          placement_drives: {
            select: {
              status: true,
              scheduled_date: true,
              package_lpa: true,
              student_drive_applications: {
                where: { status: 'placed' },
                select: { offered_package: true },
              },
            },
          },
        },
      }),
      this.loadAllExtras(),
    ]);

    return companies.map((c) => {
      const drives = c.placement_drives;
      const openRoles = drives.filter((d) => d.status === 'scheduled').length;
      const placedPackages = drives.flatMap((d) =>
        d.student_drive_applications.map((a) =>
          a.offered_package != null
            ? Number(a.offered_package)
            : d.package_lpa != null
              ? Number(d.package_lpa)
              : null,
        ),
      );
      const hired = placedPackages.length;
      const knownPackages = placedPackages.filter(
        (p): p is number => p != null,
      );
      const averagePackage = knownPackages.length
        ? Math.round(
            (knownPackages.reduce((a, b) => a + b, 0) / knownPackages.length) *
              100,
          ) / 100
        : null;
      const highestPackage = knownPackages.length
        ? Math.max(...knownPackages)
        : null;
      const lastDriveDate = drives.length
        ? drives.reduce<Date | null>(
            (latest, d) =>
              !latest || d.scheduled_date > latest ? d.scheduled_date : latest,
            null,
          )
        : null;
      const rowExtras = extras.get(c.id) ?? NO_EXTRAS;

      return {
        id: c.id,
        name: c.name,
        profile_info: c.profile_info,
        industry: rowExtras.industry,
        location: rowExtras.location,
        drives_count: drives.length,
        open_roles: openRoles,
        hired,
        average_package: averagePackage,
        highest_package: highestPackage,
        last_drive_date: lastDriveDate,
        recruiter_status:
          drives.length === 0
            ? 'no_drives'
            : drives.length === 1
              ? 'new'
              : 'returning',
      };
    });
  }

  async update(id: number, dto: UpdateCompanyDto) {
    await this.findOrThrow(id);

    try {
      await this.prisma.$executeRaw`
        UPDATE companies SET
          name = COALESCE(${dto.name ?? null}, name),
          profile_info = COALESCE(${dto.profile_info ?? null}, profile_info),
          industry = COALESCE(${dto.industry ?? null}, industry),
          location = COALESCE(${dto.location ?? null}, location),
          recruiter_spoc = COALESCE(${dto.recruiter_spoc ?? null}, recruiter_spoc),
          expected_package_lpa = COALESCE(${dto.expected_package_lpa ?? null}, expected_package_lpa)
        WHERE id = ${id}
      `;
      return this.findOne(id);
    } catch {
      const company = await this.prisma.companies.update({
        where: { id },
        data: { name: dto.name, profile_info: dto.profile_info },
      });
      return { ...company, ...NO_EXTRAS };
    }
  }

  async remove(id: number) {
    await this.findOrThrow(id);

    const driveCount = await this.prisma.placement_drives.count({
      where: { company_id: id },
    });
    if (driveCount > 0) {
      throw new ConflictException(
        'Cannot delete a company that has placement drives associated with it',
      );
    }

    await this.prisma.companies.delete({ where: { id } });
    return { id };
  }

  private async findOrThrow(id: number) {
    const company = await this.prisma.companies.findUnique({ where: { id } });
    if (!company) throw new NotFoundException(`Company ${id} not found`);
    return company;
  }
}
