import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { EquipmentService } from './equipment.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { SearchEquipmentDto } from './dto/search-equipment.dto';
import { IssueEquipmentDto } from './dto/issue-equipment.dto';
import { SearchEquipmentIssuesDto } from './dto/search-equipment-issues.dto';

@Controller('sports-admin/equipment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Get()
  findAll(@Query() query: SearchEquipmentDto) {
    return this.equipmentService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateEquipmentDto) {
    return this.equipmentService.create(dto);
  }

  @Post('issues/:issueId/return')
  returnIssue(@Param('issueId', ParseIntPipe) issueId: number) {
    return this.equipmentService.returnIssue(issueId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.equipmentService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEquipmentDto,
  ) {
    return this.equipmentService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.equipmentService.remove(id);
  }

  @Post(':id/issue')
  issue(@Param('id', ParseIntPipe) id: number, @Body() dto: IssueEquipmentDto) {
    return this.equipmentService.issue(id, dto);
  }

  @Get(':id/issues')
  findIssues(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SearchEquipmentIssuesDto,
  ) {
    return this.equipmentService.findIssues(id, query);
  }
}
