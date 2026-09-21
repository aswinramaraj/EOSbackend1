import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { CanteenTodaysSpecialService } from './canteen-todays-special.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function assertMealType(value: string | undefined): 'lunch' | 'dinner' {
  if (value !== 'lunch' && value !== 'dinner') {
    throw new BadRequestException({
      message: 'meal_type must be "lunch" or "dinner".',
      errorCode: 'INVALID_MEAL_TYPE',
    });
  }
  return value;
}

@Controller('canteen-admin/todays-special')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CANTEEN_ADMIN)
export class CanteenTodaysSpecialController {
  constructor(private readonly todaysSpecial: CanteenTodaysSpecialService) {}

  @Get()
  listActive(@Query('meal_type') mealType?: string) {
    return this.todaysSpecial.listActive(assertMealType(mealType));
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  upload(
    @CurrentUser() user: JwtPayload,
    @Query('meal_type') mealType: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException({
        message: 'An image file is required.',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return this.todaysSpecial.upload(assertMealType(mealType), file, user.sub);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.todaysSpecial.remove(id);
  }
}
