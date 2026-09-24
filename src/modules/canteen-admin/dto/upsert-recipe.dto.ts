import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';

export class RecipeIngredientLineDto {
  @IsInt()
  ingredient_id: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantity_needed: number;

  @IsNotEmpty()
  unit: string;
}

export class UpsertRecipeDto {
  @IsInt()
  dish_id: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientLineDto)
  ingredients: RecipeIngredientLineDto[];
}
