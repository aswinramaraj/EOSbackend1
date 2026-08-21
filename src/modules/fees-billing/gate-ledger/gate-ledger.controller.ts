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
import { GateLedgerService } from './gate-ledger.service';
import { CreateGateLedgerDto } from './dto/create-gate-ledger.dto';
import { UpdateGateLedgerDto } from './dto/update-gate-ledger.dto';

@Controller('gate-ledger')
export class GateLedgerController {
  constructor(private readonly gateLedgerService: GateLedgerService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() createGateLedgerDto: CreateGateLedgerDto) {
    return this.gateLedgerService.create(createGateLedgerDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.gateLedgerService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.gateLedgerService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @Body() updateGateLedgerDto: UpdateGateLedgerDto,
  ) {
    return this.gateLedgerService.update(+id, updateGateLedgerDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.gateLedgerService.remove(+id);
  }
}
