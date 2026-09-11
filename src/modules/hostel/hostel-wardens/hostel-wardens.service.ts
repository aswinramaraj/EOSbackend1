import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateHostelWardenDto } from './dto/create-hostel-warden.dto';
import { UpdateHostelWardenDto } from './dto/update-hostel-warden.dto';

/**
 * Admin's "assign a warden to a block" management — real `hostel_wardens`
 * table (block-scoped roster with a super_warden/sub_warden role,
 * distinct from `hostels.warden_user_id`'s single-warden-per-hostel auth
 * scoping), which existed already but had zero create/update/delete
 * anywhere in the app — every reader (Principal's block report, the
 * student-facing hostel-warden-name lookup, hostel announcement authorship)
 * only ever displayed whatever someone had inserted directly via SQL.
 */
@Injectable()
export class HostelWardensService {
  private readonly logger = new Logger(HostelWardensService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel/wardens
   *
   * Error cases:
   *  404 HOSTEL_BLOCK_NOT_FOUND    – block_id does not exist
   *  409 HOSTEL_WARDEN_EMP_ID_EXISTS – another warden already uses this emp_id
   */
  async create(dto: CreateHostelWardenDto) {
    await this.assertBlockExists(dto.block_id);

    const existing = await this.findByEmpId(dto.emp_id);
    if (existing) {
      throw new ConflictException({
        message: 'A warden with this employee ID already exists',
        errorCode: 'HOSTEL_WARDEN_EMP_ID_EXISTS',
      });
    }

    try {
      return await this.prisma.hostel_wardens.create({
        data: {
          block_id: dto.block_id,
          name: dto.name,
          emp_id: dto.emp_id,
          role: dto.role,
          user_id: dto.user_id,
          gender: dto.gender,
          designation: dto.designation,
          mobile: dto.mobile,
          email: dto.email,
          joined_date: dto.joined_date ? new Date(dto.joined_date) : undefined,
          quarters: dto.quarters,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating hostel warden', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /hostel/wardens?block_id= */
  async findAll(blockId?: number) {
    try {
      return await this.prisma.hostel_wardens.findMany({
        where: blockId ? { block_id: blockId } : {},
        orderBy: [{ block_id: 'asc' }, { role: 'asc' }],
      });
    } catch (err) {
      this.logger.error('DB error while fetching hostel wardens', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel/wardens/:id
   *
   * Error cases:
   *  404 HOSTEL_WARDEN_NOT_FOUND – no warden with the given id
   */
  async findOne(id: number) {
    const warden = await this.findById(id);
    if (!warden) {
      throw new NotFoundException({
        message: 'Hostel warden not found',
        errorCode: 'HOSTEL_WARDEN_NOT_FOUND',
      });
    }
    return warden;
  }

  /**
   * PATCH /hostel/wardens/:id
   *
   * Error cases:
   *  404 HOSTEL_WARDEN_NOT_FOUND     – no warden with the given id
   *  404 HOSTEL_BLOCK_NOT_FOUND      – block_id does not exist
   *  409 HOSTEL_WARDEN_EMP_ID_EXISTS – another warden already uses this emp_id
   */
  async update(id: number, dto: UpdateHostelWardenDto) {
    const warden = await this.findById(id);
    if (!warden) {
      throw new NotFoundException({
        message: 'Hostel warden not found',
        errorCode: 'HOSTEL_WARDEN_NOT_FOUND',
      });
    }

    if (dto.block_id) {
      await this.assertBlockExists(dto.block_id);
    }

    if (dto.emp_id) {
      const existing = await this.findByEmpId(dto.emp_id);
      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A warden with this employee ID already exists',
          errorCode: 'HOSTEL_WARDEN_EMP_ID_EXISTS',
        });
      }
    }

    try {
      return await this.prisma.hostel_wardens.update({
        where: { id },
        data: {
          block_id: dto.block_id,
          name: dto.name,
          emp_id: dto.emp_id,
          role: dto.role,
          user_id: dto.user_id,
          gender: dto.gender,
          designation: dto.designation,
          mobile: dto.mobile,
          email: dto.email,
          joined_date: dto.joined_date ? new Date(dto.joined_date) : undefined,
          quarters: dto.quarters,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating hostel warden', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /hostel/wardens/:id
   *
   * Error cases:
   *  404 HOSTEL_WARDEN_NOT_FOUND – no warden with the given id
   *  409 HOSTEL_WARDEN_IN_USE    – warden is referenced by a hostel_goods request
   */
  async remove(id: number) {
    const warden = await this.findById(id);
    if (!warden) {
      throw new NotFoundException({
        message: 'Hostel warden not found',
        errorCode: 'HOSTEL_WARDEN_NOT_FOUND',
      });
    }

    let goodsCount: number;
    try {
      goodsCount = await this.prisma.hostel_goods.count({
        where: { warden_id: id },
      });
    } catch (err) {
      this.logger.error('DB error while checking hostel warden usage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (goodsCount > 0) {
      throw new ConflictException({
        message: 'This warden has goods requests on file and cannot be deleted',
        errorCode: 'HOSTEL_WARDEN_IN_USE',
      });
    }

    try {
      await this.prisma.hostel_wardens.delete({ where: { id } });
      return { message: 'Hostel warden removed successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting hostel warden', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertBlockExists(blockId: number) {
    let block: unknown;
    try {
      block = await this.prisma.hostel_blocks.findUnique({
        where: { id: blockId },
      });
    } catch (err) {
      this.logger.error('DB error during hostel block lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
    if (!block) {
      throw new NotFoundException({
        message: 'Hostel block not found',
        errorCode: 'HOSTEL_BLOCK_NOT_FOUND',
      });
    }
  }

  private async findByEmpId(empId: string) {
    try {
      return await this.prisma.hostel_wardens.findUnique({
        where: { emp_id: empId },
      });
    } catch (err) {
      this.logger.error(
        'DB error during hostel warden emp_id duplicate check',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.hostel_wardens.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during hostel warden lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
