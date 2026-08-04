import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { GateLedgerService } from './gate-ledger.service';
import { CreateGateLedgerDto } from './dto/create-gate-ledger.dto';
import { UpdateGateLedgerDto } from './dto/update-gate-ledger.dto';

@Controller('gate-ledger')
export class GateLedgerController {
  constructor(private readonly gateLedgerService: GateLedgerService) {}

  @Post()
  create(@Body() createGateLedgerDto: CreateGateLedgerDto) {
    return this.gateLedgerService.create(createGateLedgerDto);
  }

  @Get()
  findAll() {
    return this.gateLedgerService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.gateLedgerService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateGateLedgerDto: UpdateGateLedgerDto,
  ) {
    return this.gateLedgerService.update(+id, updateGateLedgerDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.gateLedgerService.remove(+id);
  }
}
