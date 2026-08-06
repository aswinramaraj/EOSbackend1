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
import { ExamTimetableVersionsService } from './exam-timetable-versions.service';
import { CreateTimetableVersionDto } from './dto/create-timetable-version.dto';
import { ListTimetableVersionsQueryDto } from './dto/list-timetable-versions-query.dto';
import { PublishTimetableVersionDto } from './dto/publish-timetable-version.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SeniorCoeGuard } from 'src/auth/guards/senior-coe.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';

/**
 * Draft -> ready_to_publish -> published -> superseded/withdrawn workflow
 * for one exam's timetable (scoped per-department, or exam-wide). Unlike
 * older sibling exam modules, every route here is COE-gated — draft
 * timetable content isn't meant to be world-readable.
 */
@Controller('exam-timetable-versions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ExamTimetableVersionsController {
  constructor(private readonly versionsService: ExamTimetableVersionsService) {}

  @Post()
  async create(
    @Body() dto: CreateTimetableVersionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const version = await this.versionsService.create(dto, user.sub);
    return ApiResponse.created(
      version,
      'Timetable version created successfully.',
    );
  }

  @Get()
  async findAll(@Query() query: ListTimetableVersionsQueryDto) {
    const versions = await this.versionsService.findAll(query);
    return ApiResponse.ok(versions, 'Timetable versions fetched successfully.');
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const version = await this.versionsService.findOne(id);
    return ApiResponse.ok(version, 'Timetable version fetched successfully.');
  }

  @Patch(':id/ready-to-publish')
  async readyToPublish(@Param('id', ParseIntPipe) id: number) {
    const version = await this.versionsService.readyToPublish(id);
    return ApiResponse.ok(version, 'Timetable version staged for publish.');
  }

  @Patch(':id/return-to-drafts')
  @UseGuards(JwtAuthGuard, RolesGuard, SeniorCoeGuard)
  async returnToDrafts(@Param('id', ParseIntPipe) id: number) {
    const version = await this.versionsService.returnToDrafts(id);
    return ApiResponse.ok(version, 'Timetable version returned to drafts.');
  }

  @Patch(':id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard, SeniorCoeGuard)
  async publish(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PublishTimetableVersionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const version = await this.versionsService.publish(id, dto, user.sub);
    return ApiResponse.ok(version, 'Timetable version published successfully.');
  }

  @Patch(':id/withdraw')
  @UseGuards(JwtAuthGuard, RolesGuard, SeniorCoeGuard)
  async withdraw(@Param('id', ParseIntPipe) id: number) {
    const version = await this.versionsService.withdraw(id);
    return ApiResponse.ok(version, 'Timetable version withdrawn.');
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.versionsService.remove(id);
    return ApiResponse.ok(result, 'Timetable version deleted successfully.');
  }
}
