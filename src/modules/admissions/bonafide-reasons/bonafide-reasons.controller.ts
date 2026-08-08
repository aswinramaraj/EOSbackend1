import { Controller, Get } from '@nestjs/common';
import { BonafideReasonsService } from './bonafide-reasons.service';

@Controller('bonafide-reasons')
export class BonafideReasonsController {
  constructor(private readonly bonafideReasonsService: BonafideReasonsService) {}

  @Get()
  findAll() {
    return this.bonafideReasonsService.findAll();
  }
}
