import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { ROLES } from 'src/common/constants/roles.constant';
import { CanteenDishesService } from './canteen-dishes.service';
import { CreateDishCategoryDto } from './dto/create-dish-category.dto';
import { CreateDishDto } from './dto/create-dish.dto';
import { UpdateDishDto } from './dto/update-dish.dto';

const MAX_DISH_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB, matches the reference app's own stated limit

@Controller('canteen-admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CANTEEN_ADMIN)
export class CanteenDishesController {
  constructor(private readonly dishes: CanteenDishesService) {}

  @Get('dish-categories')
  listCategories() {
    return this.dishes.listCategories();
  }

  @Post('dish-categories')
  createCategory(@Body() dto: CreateDishCategoryDto) {
    return this.dishes.createCategory(dto);
  }

  @Get('dishes')
  listDishes(
    @Query('category_id') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.dishes.listDishes(
      categoryId ? Number(categoryId) : undefined,
      search,
    );
  }

  @Post('dishes')
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_DISH_IMAGE_BYTES } }),
  )
  createDish(
    @Body() dto: CreateDishDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.dishes.createDish(dto, file);
  }

  @Patch('dishes/:id')
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_DISH_IMAGE_BYTES } }),
  )
  updateDish(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDishDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.dishes.updateDish(id, dto, file);
  }

  @Delete('dishes/:id')
  deleteDish(@Param('id', ParseIntPipe) id: number) {
    return this.dishes.deleteDish(id);
  }
}
