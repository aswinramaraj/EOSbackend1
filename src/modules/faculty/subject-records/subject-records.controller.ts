import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { SubjectRecordsService } from './subject-records.service';

/**
 * Faculty-side "Subject Records" report — grade distribution + toppers
 * computed live from exam_marks for a class+subject the faculty teaches,
 * plus publishing the result to the class. Reads exam_subject_mapping
 * (created by COE) and faculty_subject_class_mapping (created by HoD) but
 * never creates or modifies either.
 */
@Controller('me/subject-records')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY)
export class SubjectRecordsController {
  constructor(private readonly subjectRecordsService: SubjectRecordsService) {}

  /** GET /api/v1/me/subject-records — class+subject mappings this faculty teaches. */
  @Get()
  findMappings(@CurrentUser() user: JwtPayload) {
    return this.subjectRecordsService.findMappings(user.sub);
  }

  /** GET /api/v1/me/subject-records/:exam_subject_mapping_id — grade distribution + toppers. */
  @Get(':exam_subject_mapping_id')
  findOne(
    @Param('exam_subject_mapping_id', ParseIntPipe) examSubjectMappingId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subjectRecordsService.findOne(examSubjectMappingId, user.sub);
  }

  /** POST /api/v1/me/subject-records/:exam_subject_mapping_id/publish — publish result to class. */
  @Post(':exam_subject_mapping_id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('exam_subject_mapping_id', ParseIntPipe) examSubjectMappingId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subjectRecordsService.publish(examSubjectMappingId, user.sub);
  }
}
