import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { OdService } from './od.service';
import { CreateOdDto } from './dto/create-od.dto';
import { UpdateOdDto } from './dto/update-od.dto';

@Controller('od')
export class OdController {
  constructor(private readonly odService: OdService) {}

  @Post()
  create(@Body() createOdDto: CreateOdDto) {
    return this.odService.create(createOdDto);
  }

  @Get()
  findAll() {
    return this.odService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.odService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateOdDto: UpdateOdDto) {
    return this.odService.update(+id, updateOdDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.odService.remove(+id);
  }
}
