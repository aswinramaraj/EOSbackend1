import {
  Controller,
  Get,
  Query,
  Body,
  Post,
  Patch,
  Param,
  ParseIntPipe,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { BorrowRecordsService } from './borrow-records.service';
import { CreateBorrowRecordDto } from './dto/create-borrow-record.dto';
import { UpdateBorrowRecordDto } from './dto/update-borrow-record.dto';
import { SearchBorrowRecordsDto } from './dto/search-borrow-records.dto';
import { GetMyBorrowRecordsDto } from './dto/get-my-borrow-records.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

// No class-level @Controller() prefix — each route below declares its own
// full path so both the `library/borrow-records` resource and the
// `me/library/borrow-records` student view can live in this one controller
// (per test/to_create/borrowed.md, which specs the latter as its own
// endpoint but not its own controller class).
@Controller()
export class BorrowRecordsController {
  constructor(private readonly borrowRecordsService: BorrowRecordsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('library/borrow-records')
  findAll(
    @Query() query: SearchBorrowRecordsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.borrowRecordsService.findAll(query, user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('library/borrow-records/:id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.borrowRecordsService.findOne(id, user);
  }

  // Secretary is deliberately NOT included here — per the user's explicit
  // call, a real book can only be handed over/checked back in by library
  // staff at the desk, so there's no genuine self-checkout action for a
  // Secretary account. The Secretary Library screen is view-only (see
  // findMyStaffBorrowRecords below).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student', 'library', 'admin')
  @Post('library/borrow-records')
  create(@Body() dto: CreateBorrowRecordDto, @CurrentUser() user: JwtPayload) {
    return this.borrowRecordsService.create(dto, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Patch('library/borrow-records/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBorrowRecordDto,
  ) {
    return this.borrowRecordsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Patch('library/borrow-records/:id/collect-fine')
  collectFine(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.borrowRecordsService.collectFine(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Patch('library/borrow-records/:id/settle-charge')
  settleDamageLostCharge(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.borrowRecordsService.settleDamageLostCharge(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Delete('library/borrow-records/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.borrowRecordsService.remove(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Post('library/borrow-records/send-overdue-reminders')
  sendOverdueReminders() {
    return this.borrowRecordsService.sendOverdueReminders();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Post('library/borrow-records/send-due-soon-reminders')
  sendDueSoonReminders() {
    return this.borrowRecordsService.sendDueSoonReminders();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Patch('library/borrow-records/:id/create-replacement-indent')
  createReplacementIndent(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.borrowRecordsService.createReplacementIndent(id, user);
  }

  // GET /me/library/borrow-records — per test/to_create/borrowed.md:
  // student-only, self-scoped read of the caller's own borrow history.
  // Previously served by a separate MeBorrowedController; merged in here so
  // this one controller owns everything the borrow-records module exposes.
  // Renamed from the /me/library/borrowed path to use consistent
  // "borrow-records" wording with the rest of this resource.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student')
  @Get('me/library/borrow-records')
  findMyBorrowRecords(
    @Query() query: GetMyBorrowRecordsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.borrowRecordsService.findMyBorrowRecords(query, user);
  }

  // GET /me/library/staff-borrow-records — Secretary's own borrow history,
  // mirroring the student-only route above but keyed by staff_user_id.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('secretary')
  @Get('me/library/staff-borrow-records')
  findMyStaffBorrowRecords(
    @Query() query: GetMyBorrowRecordsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.borrowRecordsService.findMyStaffBorrowRecords(query, user);
  }

  // No self-service renew/return/borrow route for Secretary — real books
  // can only be checked out, renewed and returned by library staff at the
  // desk (a real-world physical handover), so this is genuinely view-only.
}
