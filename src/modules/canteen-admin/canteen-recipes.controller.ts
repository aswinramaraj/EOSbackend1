import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CanteenRecipesService } from './canteen-recipes.service';
import { UpsertRecipeDto } from './dto/upsert-recipe.dto';

@Controller('canteen-admin/recipes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CANTEEN_ADMIN)
export class CanteenRecipesController {
  constructor(private readonly recipes: CanteenRecipesService) {}

  @Get()
  list(@Query('search') search?: string) {
    return this.recipes.list(search);
  }

  @Get('summary')
  summary() {
    return this.recipes.summary();
  }

  @Post()
  upsert(@Body() dto: UpsertRecipeDto) {
    return this.recipes.upsert(dto);
  }

  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.recipes.delete(id);
  }
}
