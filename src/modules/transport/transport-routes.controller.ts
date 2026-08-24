import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { TransportRoutesService } from './transport-routes.service';
import { TransportRouteEditService } from './transport-route-edit.service';
import { ListRoutesQueryDto } from './dto/list-routes-query.dto';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { AddRouteStudentDto } from './dto/add-route-student.dto';

@Controller('me/routes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.TRANSPORT)
export class TransportRoutesController {
  constructor(
    private readonly service: TransportRoutesService,
    private readonly editService: TransportRouteEditService,
  ) {}

  /** GET /api/v1/me/routes?search= — route list for the transport office. */
  @Get()
  findAll(@Query() query: ListRoutesQueryDto) {
    return this.service.findAll(query.search);
  }

  /** POST /api/v1/me/routes — create a route. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  createRoute(@Body() dto: CreateRouteDto) {
    return this.editService.createRoute(dto);
  }

  /** DELETE /api/v1/me/routes/:id — delete a route that nothing is using. */
  @Delete(':id')
  deleteRoute(@Param('id', ParseIntPipe) id: number) {
    return this.editService.deleteRoute(id);
  }

  /** GET /api/v1/me/routes/:id — one route + its full stage list, for editing. */
  @Get(':id')
  getRouteDetail(@Param('id', ParseIntPipe) id: number) {
    return this.editService.getRouteDetail(id);
  }

  /** PATCH /api/v1/me/routes/:id — edit a route's own fields. */
  @Patch(':id')
  updateRoute(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRouteDto) {
    return this.editService.updateRoute(id, dto);
  }

  /** POST /api/v1/me/routes/:id/stages — add a boarding stage (with its fare) to a route. */
  @Post(':id/stages')
  @HttpCode(HttpStatus.CREATED)
  createStage(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateStageDto) {
    return this.editService.createStage(id, dto);
  }

  /** GET /api/v1/me/routes/:id/students — every student currently assigned to this route. */
  @Get(':id/students')
  getRouteStudents(@Param('id', ParseIntPipe) id: number) {
    return this.editService.getRouteStudents(id);
  }

  /** POST /api/v1/me/routes/:id/students — add a student (by student ID) to this route's boarding stage. */
  @Post(':id/students')
  @HttpCode(HttpStatus.CREATED)
  addRouteStudent(@Param('id', ParseIntPipe) id: number, @Body() dto: AddRouteStudentDto) {
    return this.editService.addOrMoveStudent(id, dto);
  }

  /** DELETE /api/v1/me/routes/:id/students/:mappingId — remove a student's transport assignment. */
  @Delete(':id/students/:mappingId')
  removeRouteStudent(@Param('id', ParseIntPipe) id: number, @Param('mappingId', ParseIntPipe) mappingId: number) {
    return this.editService.removeStudent(id, mappingId);
  }
}
