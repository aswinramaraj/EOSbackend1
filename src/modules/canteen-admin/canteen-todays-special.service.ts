import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';

const IMAGE_FOLDER = 'canteen-todays-special';

@Injectable()
export class CanteenTodaysSpecialService {
  private readonly logger = new Logger(CanteenTodaysSpecialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Current live specials for one meal type, today's date — matches the reference app's "reset at 10 PM daily" behavior by simply scoping to CURRENT_DATE rather than needing an actual reset job. */
  async listActive(mealType: 'lunch' | 'dinner') {
    const rows = await this.prisma.canteen_todays_specials.findMany({
      where: {
        meal_type: mealType,
        is_active: true,
        special_date: new Date(new Date().toISOString().slice(0, 10)),
      },
      orderBy: { display_order: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      meal_type: r.meal_type,
      image_url: r.image_url,
      display_order: r.display_order,
    }));
  }

  async upload(
    mealType: 'lunch' | 'dinner',
    file: Express.Multer.File,
    createdByUserId: number,
  ) {
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException({
        message: 'Only image files are allowed.',
        errorCode: 'INVALID_FILE_TYPE',
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const currentCount = await this.prisma.canteen_todays_specials.count({
      where: {
        meal_type: mealType,
        special_date: new Date(today),
        is_active: true,
      },
    });

    const { key } = await this.storage.upload(
      IMAGE_FOLDER,
      file.originalname,
      file.buffer,
      file.mimetype,
    );
    const imageUrl = this.storage.getPublicUrl(key);

    try {
      return await this.prisma.canteen_todays_specials.create({
        data: {
          meal_type: mealType,
          image_url: imageUrl,
          display_order: currentCount,
          special_date: new Date(today),
          created_by_user_id: createdByUserId,
        },
      });
    } catch (err) {
      this.logger.error("DB error creating today's special", err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    const existing = await this.prisma.canteen_todays_specials.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Special not found.',
        errorCode: 'SPECIAL_NOT_FOUND',
      });
    }
    await this.prisma.canteen_todays_specials.update({
      where: { id },
      data: { is_active: false },
    });
    return { success: true };
  }
}
