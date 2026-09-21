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

  // Only these five roles have any legitimate reason to hit this resource —
  // student/faculty/hod are self-scoped to their own records inside the
  // service (a HoD account has a real faculty row - see
  // resolveOwnFacultyId), library/admin see everything. Missing RolesGuard
  // here previously let any other authenticated role (HR, transport,
  // canteen, ...) fall through to the service's unrestricted else-branch
  // and read every borrow record.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student', 'faculty', 'hod', 'library', 'admin')
  @Get('library/borrow-records')
  findAll(
    @Query() query: SearchBorrowRecordsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.borrowRecordsService.findAll(query, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student', 'faculty', 'hod', 'library', 'admin')
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

  // GET /me/library/borrow-records — self-scoped read of the caller's own
  // borrow history. Originally student-only (per test/to_create/borrowed.md);
  // widened to every role reachable via the mobile app's Campus tab (which
  // shares this one screen across Student/Employee/HoD/HR Payroll/Principal
  // - see EOS-mobileapp's AmenityHomeScreen.tsx) - the service resolves
  // student_id/faculty_id/staff_user_id dynamically based on whichever real
  // row the caller actually has (see findMyBorrowRecords below), same
  // resolve-by-row-not-by-role pattern already used for Leave/OD self-service.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student', 'faculty', 'hod', 'library', 'finance', 'academic_coordinator', 'hr_payroll', 'principal', 'secretary')
  @Get('me/library/borrow-records')
  findMyBorrowRecords(
    @Query() query: GetMyBorrowRecordsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.borrowRecordsService.findMyBorrowRecords(query, user);
  }

  // GET /me/library/dues-summary — student-only, self-scoped summary of
  // outstanding fines/charges, for the No-due clearance dashboard.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student')
  @Get('me/library/dues-summary')
  getMyDuesSummary(@CurrentUser() user: JwtPayload) {
    return this.borrowRecordsService.getMyDuesSummary(user);
  }

  // GET /me/library/staff-borrow-records — Secretary/HR Payroll's own borrow
  // history, mirroring the student-only route above but keyed by
  // staff_user_id (a plain users.id) rather than a faculty/student row -
  // the resolution inside findMyStaffBorrowRecords is already role-agnostic
  // (keyed purely by currentUser.sub), unlike the faculty/hod path above,
  // since HR Payroll accounts have no faculty row to self-scope through.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('secretary', 'hr_payroll')
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
