import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BorrowRequestsService } from './borrow-requests.service';
import { CreateBorrowRequestDto } from './dto/create-borrow-request.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

// Same no-class-prefix convention as BorrowRecordsController — this one
// class owns both the student-facing /me/library/borrow-requests routes
// and the staff-facing /library/borrow-requests queue.
@Controller()
export class BorrowRequestsController {
  constructor(private readonly borrowRequestsService: BorrowRequestsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student', 'faculty', 'hod')
  @Post('me/library/borrow-requests')
  create(@Body() dto: CreateBorrowRequestDto, @CurrentUser() user: JwtPayload) {
    return this.borrowRequestsService.create(dto.book_id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student', 'faculty', 'hod')
  @Get('me/library/borrow-requests')
  findMine(@CurrentUser() user: JwtPayload) {
    return this.borrowRequestsService.findMineForCaller(user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Get('library/borrow-requests')
  findAll() {
    return this.borrowRequestsService.findAllForStaff();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Patch('library/borrow-requests/:id/accept')
  accept(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.borrowRequestsService.accept(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Patch('library/borrow-requests/:id/reject')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.borrowRequestsService.reject(id, user);
  }
}
