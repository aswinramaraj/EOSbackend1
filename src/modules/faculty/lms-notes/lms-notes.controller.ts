import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { LmsNotesService } from './lms-notes.service';
import { CreateLmsNoteDto } from './dto/create-lms-note.dto';
import { UpdateLmsNoteDto } from './dto/update-lms-note.dto';
import { ListLmsNoteQueryDto } from './dto/list-lms-note-query.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LmsNotesController {
  constructor(private readonly lmsNotesService: LmsNotesService) {}

  /**
   * POST /api/v1/lms-notes — Faculty/HoD. HOD included so an HoD mapped to
   * teach a subject (Switch Account's "Subject Handling Faculty" mode) can
   * upload notes the same as any other faculty - resolved via
   * faculty.user_id, still gated by assertFacultyMapped, same precedent as
   * ExamMarksController.
   */
  @Post('lms-notes')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateLmsNoteDto, @CurrentUser() user: JwtPayload) {
    return this.lmsNotesService.create(dto, user.sub);
  }

  /** GET /api/v1/lms-notes — Faculty/HoD/Student. Paginated, filterable. */
  @Get('lms-notes')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.STUDENT)
  findAll(@Query() query: ListLmsNoteQueryDto) {
    return this.lmsNotesService.findAll(query);
  }

  /** GET /api/v1/lms-notes/:id — Faculty/HoD/Student. */
  @Get('lms-notes/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.STUDENT)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.lmsNotesService.findOne(id);
  }

  /** PATCH /api/v1/lms-notes/:id — Faculty/HoD, and only the faculty who owns it. */
  @Patch('lms-notes/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLmsNoteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsNotesService.update(id, dto, user.sub);
  }

  /** DELETE /api/v1/lms-notes/:id — Faculty/HoD, and only the faculty who owns it. */
  @Delete('lms-notes/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lmsNotesService.remove(id, user.sub);
  }
}
