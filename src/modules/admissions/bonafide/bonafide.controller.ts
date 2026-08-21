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
import { BonafideService } from './bonafide.service';
import { CreateBonafideDto } from './dto/create-bonafide.dto';
import { UpdateBonafideDto } from './dto/update-bonafide.dto';

@Controller('bonafide')
export class BonafideController {
  constructor(private readonly bonafideService: BonafideService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() createBonafideDto: CreateBonafideDto) {
    return this.bonafideService.create(createBonafideDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return [];
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.bonafideService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @Body() updateBonafideDto: UpdateBonafideDto,
  ) {
    return this.bonafideService.update(+id, updateBonafideDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.bonafideService.remove(+id);
  }
}
