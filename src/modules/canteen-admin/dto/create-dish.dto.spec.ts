import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { CreateDishDto } from './create-dish.dto';

describe('CreateDishDto boolean parsing', () => {
  // Regression coverage: this DTO is only ever populated from a
  // multipart/form-data body (dish image upload), where every field
  // — including booleans — arrives as a string. The original
  // `@Type(() => Boolean)` decorator called the native `Boolean(value)`
  // cast, which makes the STRING "false" coerce to `true` (any non-empty
  // string is truthy), silently making is_veg/is_available impossible to
  // ever set to false. Fixed with an explicit string-aware transform.
  it('parses the string "false" as false, not true', () => {
    const dto = plainToInstance(CreateDishDto, {
      name: 'Test Dish',
      price: '10',
      is_veg: 'false',
      is_available: 'false',
    });
    expect(dto.is_veg).toBe(false);
    expect(dto.is_available).toBe(false);
  });

  it('parses the string "true" as true', () => {
    const dto = plainToInstance(CreateDishDto, {
      name: 'Test Dish',
      price: '10',
      is_veg: 'true',
      is_available: 'true',
    });
    expect(dto.is_veg).toBe(true);
    expect(dto.is_available).toBe(true);
  });

  it('defaults to true when the field is omitted', () => {
    const dto = plainToInstance(CreateDishDto, {
      name: 'Test Dish',
      price: '10',
    });
    expect(dto.is_veg).toBe(true);
    expect(dto.is_available).toBe(true);
  });
});
