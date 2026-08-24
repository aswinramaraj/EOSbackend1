import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { PassRulesService } from './pass-rules.service';
import { UpdatePassRulesDto } from './dto/update-pass-rules.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { ApiResponse } from 'src/common/dto/api-response.dto';

@Controller('pass-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class PassRulesController {
  constructor(private readonly passRulesService: PassRulesService) {}

  @Get()
  findOne() {
    return this.passRulesService.findOne();
  }

  @Patch()
  async update(@Body() updatePassRulesDto: UpdatePassRulesDto) {
    const rules = await this.passRulesService.update(updatePassRulesDto);
    return ApiResponse.ok(rules, 'Pass rules updated successfully');
  }
}
