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
import { ROLES } from 'src/common/constants/roles.constant';
import { HigherEducationAspirantsService } from './higher-education-aspirants.service';
import { ListAspirantsQueryDto } from './dto/list-aspirants-query.dto';
import { CreateAspirantDto } from './dto/create-aspirant.dto';
import { UpdateAspirantDto } from './dto/update-aspirant.dto';

@Controller('me/higher-education-aspirants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HIGHER_EDUCATION)
export class HigherEducationAspirantsController {
  constructor(private readonly service: HigherEducationAspirantsService) {}

  /** GET /api/v1/me/higher-education-aspirants?search=&batch=&department=&status= — aspirant roster for the Higher Education Cell. */
  @Get()
  findAll(@Query() query: ListAspirantsQueryDto) {
    return this.service.findAll(query);
  }

  /** POST /api/v1/me/higher-education-aspirants — add (or update) a student's higher-education file, identified by register number. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  createAspirant(@Body() dto: CreateAspirantDto) {
    return this.service.createAspirant(dto);
  }

  /** GET /api/v1/me/higher-education-aspirants/:id — one aspirant's full higher-education file. */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  /** PATCH /api/v1/me/higher-education-aspirants/:id — edit the aspiration record. */
  @Patch(':id')
  updateAspirant(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAspirantDto,
  ) {
    return this.service.updateAspirant(id, dto);
  }

  /** DELETE /api/v1/me/higher-education-aspirants/:id — removes the record, not the student. */
  @Delete(':id')
  deleteAspirant(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteAspirant(id);
  }
}
