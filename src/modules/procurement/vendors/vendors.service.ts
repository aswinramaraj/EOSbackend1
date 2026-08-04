import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /vendors
   *
   * Error cases:
   *  500 INTERNAL_ERROR – unexpected failure (DB, etc.)
   */
  async create(dto: CreateVendorDto) {
    try {
      return await this.prisma.vendors.create({
        data: {
          name: dto.name,
          contact_info: dto.contact_info,
          gst_no: dto.gst_no,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating vendor', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /vendors
   */
  async findAll() {
    try {
      return await this.prisma.vendors.findMany({
        orderBy: { id: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching vendors', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /vendors/:id
   *
   * Error cases:
   *  404 VENDOR_NOT_FOUND – no vendor with the given id
   */
  async findOne(id: number) {
    const vendor = await this.findById(id);

    if (!vendor) {
      throw new NotFoundException({
        message: 'Vendor not found',
        errorCode: 'VENDOR_NOT_FOUND',
      });
    }

    return vendor;
  }

  /**
   * PUT/PATCH /vendors/:id
   *
   * Error cases:
   *  404 VENDOR_NOT_FOUND – no vendor with the given id
   */
  async update(id: number, dto: UpdateVendorDto) {
    const vendor = await this.findById(id);

    if (!vendor) {
      throw new NotFoundException({
        message: 'Vendor not found',
        errorCode: 'VENDOR_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.vendors.update({
        where: { id },
        data: {
          name: dto.name,
          contact_info: dto.contact_info,
          gst_no: dto.gst_no,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating vendor', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /vendors/:id
   *
   * Error cases:
   *  404 VENDOR_NOT_FOUND – no vendor with the given id
   *  409 VENDOR_IN_USE    – vendor is referenced by purchase_order_proposals,
   *                         service_order_proposals or vendor_quotations
   */
  async remove(id: number) {
    const vendor = await this.findById(id);

    if (!vendor) {
      throw new NotFoundException({
        message: 'Vendor not found',
        errorCode: 'VENDOR_NOT_FOUND',
      });
    }

    let usageCounts: number[];

    try {
      usageCounts = await Promise.all([
        this.prisma.purchase_order_proposals.count({
          where: { vendor_id: id },
        }),
        this.prisma.service_order_proposals.count({ where: { vendor_id: id } }),
        this.prisma.vendor_quotations.count({ where: { vendor_id: id } }),
      ]);
    } catch (err) {
      this.logger.error('DB error while checking vendor usage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (usageCounts.some((count) => count > 0)) {
      throw new ConflictException({
        message: 'This vendor is in use and cannot be deleted',
        errorCode: 'VENDOR_IN_USE',
      });
    }

    try {
      return await this.prisma.vendors.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting vendor', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.vendors.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during vendor lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
