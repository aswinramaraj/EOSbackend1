import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OdService } from './od.service';
import { CreateOdDto } from './dto/create-od.dto';
import { UpdateOdDto } from './dto/update-od.dto';

@Controller('od')
export class OdController {
  constructor(private readonly odService: OdService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() createOdDto: CreateOdDto) {
    return this.odService.create(createOdDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.odService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.odService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@Param('id') id: string, @Body() updateOdDto: UpdateOdDto) {
    return this.odService.update(+id, updateOdDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.odService.remove(+id);
  }
}
