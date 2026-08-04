import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { BonafideService } from './bonafide.service';
import { CreateBonafideDto } from './dto/create-bonafide.dto';
import { UpdateBonafideDto } from './dto/update-bonafide.dto';

@Controller('bonafide')
export class BonafideController {
  constructor(private readonly bonafideService: BonafideService) {}

  @Post()
  create(@Body() createBonafideDto: CreateBonafideDto) {
    return this.bonafideService.create(createBonafideDto);
  }

  @Get()
  findAll() {
    return [];
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bonafideService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBonafideDto: UpdateBonafideDto,
  ) {
    return this.bonafideService.update(+id, updateBonafideDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.bonafideService.remove(+id);
  }
}
