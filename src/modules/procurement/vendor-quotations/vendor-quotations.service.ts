import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { CreateVendorQuotationDto } from './dto/create-vendor-quotation.dto';
import { UpdateVendorQuotationDto } from './dto/update-vendor-quotation.dto';

@Injectable()
export class VendorQuotationsService {
  private readonly logger = new Logger(VendorQuotationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /vendor-quotations
   *
   * quotation_date is never accepted from the client — Postgres applies the
   * schema default (CURRENT_DATE) automatically.
   *
   * Error cases:
   *  404 VENDOR_NOT_FOUND – vendor_id does not exist
   *  500 INTERNAL_ERROR   – unexpected failure (DB, etc.)
   */
  async create(dto: CreateVendorQuotationDto) {
    await this.assertVendorExists(dto.vendor_id);

    const quotedPrice = new Prisma.Decimal(dto.quoted_price);

    try {
      return await this.prisma.vendor_quotations.create({
        data: {
          vendor_id: dto.vendor_id,
          item_description: dto.item_description,
          quoted_price: quotedPrice,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating vendor quotation', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /vendor-quotations
   */
  async findAll() {
    try {
      return await this.prisma.vendor_quotations.findMany({
        orderBy: [{ quotation_date: 'desc' }, { id: 'desc' }],
      });
    } catch (err) {
      this.logger.error('DB error while fetching vendor quotations', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /vendor-quotations/:id
   *
   * Error cases:
   *  404 VENDOR_QUOTATION_NOT_FOUND – no quotation with the given id
   */
  async findOne(id: number) {
    const quotation = await this.findById(id);

    if (!quotation) {
      throw new NotFoundException({
        message: 'Vendor quotation not found',
        errorCode: 'VENDOR_QUOTATION_NOT_FOUND',
      });
    }

    return quotation;
  }

  /**
   * PUT/PATCH /vendor-quotations/:id
   *
   * Error cases:
   *  404 VENDOR_QUOTATION_NOT_FOUND – no quotation with the given id
   *  404 VENDOR_NOT_FOUND           – vendor_id does not exist
   */
  async update(id: number, dto: UpdateVendorQuotationDto) {
    const quotation = await this.findById(id);

    if (!quotation) {
      throw new NotFoundException({
        message: 'Vendor quotation not found',
        errorCode: 'VENDOR_QUOTATION_NOT_FOUND',
      });
    }

    if (dto.vendor_id !== undefined && dto.vendor_id !== quotation.vendor_id) {
      await this.assertVendorExists(dto.vendor_id);
    }

    const quotedPrice =
      dto.quoted_price !== undefined
        ? new Prisma.Decimal(dto.quoted_price)
        : undefined;

    try {
      return await this.prisma.vendor_quotations.update({
        where: { id },
        data: {
          vendor_id: dto.vendor_id,
          item_description: dto.item_description,
          quoted_price: quotedPrice,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating vendor quotation', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /vendor-quotations/:id
   *
   * Error cases:
   *  404 VENDOR_QUOTATION_NOT_FOUND – no quotation with the given id
   */
  async remove(id: number) {
    const quotation = await this.findById(id);

    if (!quotation) {
      throw new NotFoundException({
        message: 'Vendor quotation not found',
        errorCode: 'VENDOR_QUOTATION_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.vendor_quotations.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting vendor quotation', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertVendorExists(vendorId: number) {
    let vendor: unknown;

    try {
      vendor = await this.prisma.vendors.findUnique({
        where: { id: vendorId },
      });
    } catch (err) {
      this.logger.error('DB error during vendor lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!vendor) {
      throw new NotFoundException({
        message: 'Vendor not found',
        errorCode: 'VENDOR_NOT_FOUND',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.vendor_quotations.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during vendor quotation lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
