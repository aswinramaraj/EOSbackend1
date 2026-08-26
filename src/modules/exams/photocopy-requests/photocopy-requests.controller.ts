import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PhotocopyRequestsService } from './photocopy-requests.service';
import { UpdatePhotocopyRequestDto } from './dto/update-photocopy-request.dto';
import { FindPhotocopyRequestsQueryDto } from './dto/find-photocopy-requests-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { ApiResponse } from 'src/common/dto/api-response.dto';

@Controller('photocopy-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class PhotocopyRequestsController {
  constructor(
    private readonly photocopyRequestsService: PhotocopyRequestsService,
  ) {}

  @Get()
  findAll(@Query() query: FindPhotocopyRequestsQueryDto) {
    return this.photocopyRequestsService.findAll(query);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePhotocopyRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const request = await this.photocopyRequestsService.update(
      id,
      dto,
      user.sub,
    );
    return ApiResponse.ok(request, 'Photocopy request updated successfully');
  }
}
