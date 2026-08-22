import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { BonafideReasonsService } from './bonafide-reasons.service';

@Controller('bonafide-reasons')
export class BonafideReasonsController {
  constructor(private readonly bonafideReasonsService: BonafideReasonsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.bonafideReasonsService.findAll();
  }
}
