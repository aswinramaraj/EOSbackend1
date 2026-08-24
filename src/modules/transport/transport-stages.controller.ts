import { Body, Controller, Delete, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { TransportRouteEditService } from './transport-route-edit.service';
import { UpdateStageDto } from './dto/update-stage.dto';

@Controller('me/stages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.TRANSPORT)
export class TransportStagesController {
  constructor(private readonly editService: TransportRouteEditService) {}

  /** PATCH /api/v1/me/stages/:id — edit a boarding stage's name/fare/time/order. */
  @Patch(':id')
  updateStage(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStageDto) {
    return this.editService.updateStage(id, dto);
  }

  /** DELETE /api/v1/me/stages/:id — remove a boarding stage nothing depends on. */
  @Delete(':id')
  deleteStage(@Param('id', ParseIntPipe) id: number) {
    return this.editService.deleteStage(id);
  }
}
