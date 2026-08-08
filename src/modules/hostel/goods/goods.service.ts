import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { CreateGoodsDto } from './dto/create-goods.dto';
import { UpdateGoodsDto } from './dto/update-goods.dto';
import { SearchGoodsDto } from './dto/search-goods.dto';

const GOODS_INCLUDE = {
  hostel_wardens: { select: { id: true, name: true, emp_id: true } },
  hostel_blocks: { select: { id: true, name: true } },
} satisfies Prisma.hostel_goodsInclude;

type GoodsWithRelations = Prisma.hostel_goodsGetPayload<{
  include: typeof GOODS_INCLUDE;
}>;

function toGoodsResponse(goods: GoodsWithRelations) {
  return {
    id: goods.id,
    req_date: goods.req_date.toISOString().slice(0, 10),
    location: goods.location,
    item: goods.item,
    purpose: goods.purpose,
    warden: goods.hostel_wardens,
    block: goods.hostel_blocks,
    received: goods.received,
    created_at: goods.created_at.toISOString(),
  };
}

@Injectable()
export class GoodsService {
  private readonly logger = new Logger(GoodsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /hostel-goods */
  async create(dto: CreateGoodsDto) {
    try {
      const goods = await this.prisma.hostel_goods.create({
        data: {
          req_date: dto.req_date ? new Date(dto.req_date) : undefined,
          location: dto.location,
          item: dto.item,
          purpose: dto.purpose,
          warden_id: dto.warden_id,
          block_id: dto.block_id,
          received: dto.received ?? false,
        },
        include: GOODS_INCLUDE,
      });
      return toGoodsResponse(goods);
    } catch (err) {
      this.logger.error('DB error while creating hostel goods entry', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /hostel-goods?block_id=&received=&page=&page_size= */
  async findAll(dto: SearchGoodsDto) {
    const { block_id, received, page = 1, page_size = 20 } = dto;

    const where: Prisma.hostel_goodsWhereInput = {};
    if (block_id) where.block_id = block_id;
    if (received !== undefined) where.received = received;

    try {
      const [goods, total] = await this.prisma.$transaction([
        this.prisma.hostel_goods.findMany({
          where,
          include: GOODS_INCLUDE,
          orderBy: { req_date: 'desc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.hostel_goods.count({ where }),
      ]);

      return { page, page_size, total, data: goods.map(toGoodsResponse) };
    } catch (err) {
      this.logger.error('DB error while fetching hostel goods', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /hostel-goods/:id
   *
   * Error cases:
   *  404 GOODS_NOT_FOUND – no goods entry with the given id
   */
  async update(id: number, dto: UpdateGoodsDto) {
    const goods = await this.prisma.hostel_goods.findUnique({ where: { id } });
    if (!goods) {
      throw new NotFoundException({
        message: 'Hostel goods entry not found',
        errorCode: 'GOODS_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.hostel_goods.update({
        where: { id },
        data: {
          req_date: dto.req_date ? new Date(dto.req_date) : undefined,
          location: dto.location,
          item: dto.item,
          purpose: dto.purpose,
          warden_id: dto.warden_id,
          block_id: dto.block_id,
          received: dto.received,
          updated_at: new Date(),
        },
        include: GOODS_INCLUDE,
      });
      return toGoodsResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating hostel goods entry', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
