import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  private readonly logger = new Logger(DepartmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /departments
   *
   * Error cases:
   *  409 DEPARTMENT_CODE_EXISTS – code already in use
   *  500 INTERNAL_ERROR         – unexpected DB failure
   */
  async create(createDepartmentDto: CreateDepartmentDto) {
    const existing = await this.prisma.departments.findUnique({
      where: {
        code: createDepartmentDto.code,
      },
    });

    if (existing) {
      throw new ConflictException({
        message: 'Department code already exists',
        errorCode: 'DEPARTMENT_CODE_EXISTS',
      });
    }

    try {
      return await this.prisma.departments.create({
        data: {
          name: createDepartmentDto.name,
          code: createDepartmentDto.code,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'Department code already exists',
          errorCode: 'DEPARTMENT_CODE_EXISTS',
        });
      }

      this.logger.error('DB error while creating department', err);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    return this.prisma.departments.findMany();
  }

  async findOne(id: number) {
    return this.prisma.departments.findUnique({
      where: {
        id,
      },
    });
  }

  update(id: number, updateDepartmentDto: UpdateDepartmentDto) {
    return `This action updates a #${id} department`;
  }

  remove(id: number) {
    return `This action removes a #${id} department`;
  }
}
