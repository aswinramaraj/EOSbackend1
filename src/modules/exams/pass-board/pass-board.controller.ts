import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';
import { PassBoardService } from './pass-board.service';
import { SetGraceDto } from './dto/set-grace.dto';
import { AddSignoffDto } from './dto/add-signoff.dto';

@Controller('pass-board')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class PassBoardController {
  constructor(private readonly service: PassBoardService) {}

  @Get()
  async getSheet(@Query('exam_id', ParseIntPipe) examId: number) {
    const detail = await this.service.getSheetDetail(examId);
    return ApiResponse.ok(detail, 'Pass board sheet fetched successfully.');
  }

  @Post('grace')
  async setGrace(@Query('exam_id', ParseIntPipe) examId: number, @Body() dto: SetGraceDto) {
    const grace = await this.service.setGrace(examId, dto);
    return ApiResponse.ok(grace, 'Grace marks recorded successfully.');
  }

  @Post('signoffs')
  async addSignoff(@Query('exam_id', ParseIntPipe) examId: number, @Body() dto: AddSignoffDto) {
    const signoff = await this.service.addSignoff(examId, dto);
    return ApiResponse.created(signoff, 'Board member added successfully.');
  }

  @Post('signoffs/:id/sign')
  async sign(@Param('id', ParseIntPipe) id: number) {
    const signoff = await this.service.sign(id);
    return ApiResponse.ok(signoff, 'Signed successfully.');
  }

  @Post('freeze')
  async freeze(@Query('exam_id', ParseIntPipe) examId: number) {
    const sheet = await this.service.freeze(examId);
    return ApiResponse.ok(sheet, 'Sheet approved and frozen successfully.');
  }

  @Post('reset')
  async reset(@Query('exam_id', ParseIntPipe) examId: number) {
    const result = await this.service.resetModeration(examId);
    return ApiResponse.ok(result, 'Moderation reset successfully.');
  }
}
