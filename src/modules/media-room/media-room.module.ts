import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MediaEquipmentController } from './media-equipment.controller';
import { MediaEquipmentService } from './media-equipment.service';
import { MediaIndentsController } from './media-indents.controller';
import { MediaIndentsService } from './media-indents.service';
import { MediaTeamController } from './media-team.controller';
import { MediaTeamService } from './media-team.service';
import { MediaShootsController } from './media-shoots.controller';
import { MediaShootsService } from './media-shoots.service';
import { MediaRoomReportsController } from './media-reports.controller';
import { MediaRoomReportsService } from './media-reports.service';
import { MediaRoomLibraryController } from './employee/media-room-library.controller';
import { MediaRoomLibraryService } from './employee/media-room-library.service';

/**
 * Media Room back office: gear inventory, indents, roster, shoot scheduling
 * and reporting.
 *
 * Media *requests* deliberately live elsewhere (faculty/media-requests) — that
 * resource is shared with Faculty and Secretary, who raise the requests this
 * module's shoots are scheduled against, so it is not duplicated here.
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    MediaEquipmentController,
    MediaIndentsController,
    MediaTeamController,
    MediaShootsController,
    MediaRoomReportsController,
    MediaRoomLibraryController,
  ],
  providers: [
    MediaEquipmentService,
    MediaIndentsService,
    MediaTeamService,
    MediaShootsService,
    MediaRoomReportsService,
    MediaRoomLibraryService,
  ],
})
export class MediaRoomModule {}
