import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdatePassRulesDto } from './dto/update-pass-rules.dto';
import { CreateGradeBandDto } from './dto/create-grade-band.dto';
import { UpdateGradeBandDto } from './dto/update-grade-band.dto';

@Injectable()
export class ExamSettingsService {
  private readonly logger = new Logger(ExamSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Singleton config row — created lazily on first read/write, same idiom as hostel_settings. */
  private async getOrCreatePassRulesRow() {
    try {
      const existing = await this.prisma.exam_pass_rules_settings.findFirst();
      if (existing) return existing;
      return await this.prisma.exam_pass_rules_settings.create({ data: {} });
    } catch (err) {
      this.logger.error('DB error while loading exam pass rules', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async getPassRules() {
    return this.getOrCreatePassRulesRow();
  }

  async updatePassRules(dto: UpdatePassRulesDto) {
    const row = await this.getOrCreatePassRulesRow();
    try {
      return await this.prisma.exam_pass_rules_settings.update({
        where: { id: row.id },
        data: dto,
      });
    } catch (err) {
      this.logger.error('DB error while updating exam pass rules', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async listGradeBands() {
    try {
      return await this.prisma.grade_bands.findMany({
        orderBy: { display_order: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching grade bands', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async createGradeBand(dto: CreateGradeBandDto) {
    try {
      return await this.prisma.grade_bands.create({ data: dto });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'A grade band with this label already exists.',
          errorCode: 'GRADE_BAND_EXISTS',
        });
      }
      this.logger.error('DB error while creating grade band', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async updateGradeBand(id: number, dto: UpdateGradeBandDto) {
    const existing = await this.prisma.grade_bands.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Grade band not found.',
        errorCode: 'GRADE_BAND_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.grade_bands.update({ where: { id }, data: dto });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'A grade band with this label already exists.',
          errorCode: 'GRADE_BAND_EXISTS',
        });
      }
      this.logger.error('DB error while updating grade band', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async removeGradeBand(id: number) {
    const existing = await this.prisma.grade_bands.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Grade band not found.',
        errorCode: 'GRADE_BAND_NOT_FOUND',
      });
    }

    try {
      await this.prisma.grade_bands.delete({ where: { id } });
      return { id };
    } catch (err) {
      this.logger.error('DB error while deleting grade band', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
