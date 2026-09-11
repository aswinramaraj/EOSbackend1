import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';
import { ScriptBundlesService } from './script-bundles.service';
import { ListBundlesQueryDto } from './dto/list-bundles-query.dto';
import { AllocateBundleDto } from './dto/allocate-bundle.dto';
import { EnterScriptMarkDto } from './dto/enter-script-mark.dto';

@Controller('script-bundles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ScriptBundlesController {
  constructor(private readonly service: ScriptBundlesService) {}

  @Get('stats')
  async getStats(@Query('exam_id', ParseIntPipe) examId: number) {
    const stats = await this.service.getStats(examId);
    return ApiResponse.ok(stats, 'Valuation stats fetched successfully.');
  }

  @Get()
  async findAll(@Query() query: ListBundlesQueryDto) {
    const bundles = await this.service.findAll(query);
    return ApiResponse.ok(bundles, 'Script bundles fetched successfully.');
  }

  @Post()
  async allocate(@Body() dto: AllocateBundleDto) {
    const bundle = await this.service.allocate(dto);
    return ApiResponse.created(bundle, 'Bundle allocated successfully.');
  }

  @Get(':id/sheet')
  async getMarkSheet(@Param('id', ParseIntPipe) id: number) {
    const sheet = await this.service.getMarkSheet(id);
    return ApiResponse.ok(sheet, 'Mark sheet fetched successfully.');
  }

  @Post(':id/marks')
  async enterMark(@Param('id', ParseIntPipe) id: number, @Body() dto: EnterScriptMarkDto) {
    const sheet = await this.service.enterMark(id, dto);
    return ApiResponse.ok(sheet, 'Mark entered successfully.');
  }

  @Post(':id/submit')
  async submit(@Param('id', ParseIntPipe) id: number) {
    const bundle = await this.service.submitBundle(id);
    return ApiResponse.ok(bundle, 'Bundle submitted and locked successfully.');
  }
}
