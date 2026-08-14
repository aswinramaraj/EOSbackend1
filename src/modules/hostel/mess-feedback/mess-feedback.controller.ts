import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MessFeedbackService } from './mess-feedback.service';
import { CreateMessFeedbackDto } from './dto/create-mess-feedback.dto';
import { SearchMessFeedbackDto } from './dto/search-mess-feedback.dto';

@Controller('hostel/mess-feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.WARDEN)
export class MessFeedbackController {
  constructor(private readonly messFeedbackService: MessFeedbackService) {}

  @Post()
  create(@Body() dto: CreateMessFeedbackDto) {
    return this.messFeedbackService.create(dto);
  }

  @Get()
  findAll(@Query() query: SearchMessFeedbackDto) {
    return this.messFeedbackService.findAll(query);
  }
}
