import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDemandCategoryDto } from './dto/create-demand-category.dto';
import { UpdateDemandCategoryDto } from './dto/update-demand-category.dto';

@Injectable()
export class DemandService {
  private readonly logger = new Logger(DemandService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /demand-categories
   *
   * Error cases:
   *  409 DEMAND_CATEGORY_EXISTS – a demand category with the same name already exists
   *  500 INTERNAL_ERROR         – unexpected failure (DB, etc.)
   */
  async create(dto: CreateDemandCategoryDto) {
    const existing = await this.findByName(dto.name);

    if (existing) {
      throw new ConflictException({
        message: 'A demand category with this name already exists',
        errorCode: 'DEMAND_CATEGORY_EXISTS',
      });
    }

    try {
      return await this.prisma.demand_categories.create({
        data: { name: dto.name },
      });
    } catch (err) {
      this.logger.error('DB error while creating demand category', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /demand-categories
   */
  async findAll() {
    try {
      return await this.prisma.demand_categories.findMany({
        orderBy: { name: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching demand categories', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /demand-categories/:id
   *
   * Error cases:
   *  404 DEMAND_CATEGORY_NOT_FOUND – no category with the given id
   */
  async findOne(id: number) {
    const category = await this.findById(id);

    if (!category) {
      throw new NotFoundException({
        message: 'Demand category not found',
        errorCode: 'DEMAND_CATEGORY_NOT_FOUND',
      });
    }

    return category;
  }

  /**
   * PUT /demand-categories/:id
   *
   * Error cases:
   *  404 DEMAND_CATEGORY_NOT_FOUND – no category with the given id
   *  409 DEMAND_CATEGORY_EXISTS    – another category already uses this name
   */
  async update(id: number, dto: UpdateDemandCategoryDto) {
    const category = await this.findById(id);

    if (!category) {
      throw new NotFoundException({
        message: 'Demand category not found',
        errorCode: 'DEMAND_CATEGORY_NOT_FOUND',
      });
    }

    if (dto.name) {
      const existing = await this.findByName(dto.name);

      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A demand category with this name already exists',
          errorCode: 'DEMAND_CATEGORY_EXISTS',
        });
      }
    }

    try {
      return await this.prisma.demand_categories.update({
        where: { id },
        data: { name: dto.name },
      });
    } catch (err) {
      this.logger.error('DB error while updating demand category', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /demand-categories/:id
   *
   * Error cases:
   *  404 DEMAND_CATEGORY_NOT_FOUND      – no category with the given id
   *  409 DEMAND_CATEGORY_IN_USE         – category is referenced by fee_structure_items
   */
  async remove(id: number) {
    const category = await this.findById(id);

    if (!category) {
      throw new NotFoundException({
        message: 'Demand category not found',
        errorCode: 'DEMAND_CATEGORY_NOT_FOUND',
      });
    }

    let usageCount: number;

    try {
      usageCount = await this.prisma.fee_structure_items.count({
        where: { demand_category_id: id },
      });
    } catch (err) {
      this.logger.error('DB error while checking demand category usage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (usageCount > 0) {
      throw new ConflictException({
        message: 'This demand category is in use and cannot be deleted',
        errorCode: 'DEMAND_CATEGORY_IN_USE',
      });
    }

    try {
      return await this.prisma.demand_categories.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting demand category', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findByName(name: string) {
    try {
      return await this.prisma.demand_categories.findUnique({
        where: { name },
      });
    } catch (err) {
      this.logger.error('DB error during demand category duplicate check', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.demand_categories.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during demand category lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
