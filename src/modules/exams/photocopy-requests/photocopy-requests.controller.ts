import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PhotocopyRequestsService } from './photocopy-requests.service';
import { CreatePhotocopyRequestDto } from './dto/create-photocopy-request.dto';
import { FindPhotocopyRequestsQueryDto } from './dto/find-photocopy-requests-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';

@Controller()
export class PhotocopyRequestsController {
  constructor(
    private readonly photocopyRequestsService: PhotocopyRequestsService,
  ) {}

  @Post('me/photocopy-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  async create(
    @Body() dto: CreatePhotocopyRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const request = await this.photocopyRequestsService.create(dto, user.sub);
    return ApiResponse.created(
      request,
      'Photocopy request created successfully.',
    );
  }

  @Get('me/photocopy-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.STUDENT)
  async findOwn(
    @Query() query: FindPhotocopyRequestsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const requests = await this.photocopyRequestsService.findOwn(
      user.sub,
      query,
    );
    return ApiResponse.ok(requests, 'Photocopy requests fetched successfully.');
  }

  @Get('photocopy-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async findAll(@Query() query: FindPhotocopyRequestsQueryDto) {
    const requests = await this.photocopyRequestsService.findAll(query);
    return ApiResponse.ok(requests, 'Photocopy requests fetched successfully.');
  }

  @Get('photocopy-requests/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const request = await this.photocopyRequestsService.findOne(id);
    return ApiResponse.ok(request, 'Photocopy request fetched successfully.');
  }

  @Patch('photocopy-requests/:id/scan')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async scan(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    const request = await this.photocopyRequestsService.scan(id, user.sub);
    return ApiResponse.ok(request, 'Photocopy request marked as scanned.');
  }

  @Patch('photocopy-requests/:id/issue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async issue(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    const request = await this.photocopyRequestsService.issue(id, user.sub);
    return ApiResponse.ok(request, 'Photocopy issued successfully.');
  }

  @Patch('photocopy-requests/:id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    const request = await this.photocopyRequestsService.reject(id, user.sub);
    return ApiResponse.ok(request, 'Photocopy request rejected.');
  }
}
