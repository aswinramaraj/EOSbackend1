import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CloudinaryStorageProvider } from 'src/modules/storage/providers/cloudinary-storage.provider';
import { AttendanceCvService } from './attendance-cv.service';
import { AttendanceCvController } from './attendance-cv.controller';

/**
 * CloudinaryStorageProvider is provided here directly (not via the shared
 * StorageModule/StorageProvider token) — it's used only to persist the
 * attendance evidence photo, nothing else in the app should pick it up.
 * See CloudinaryStorageProvider's own doc comment for why.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AttendanceCvController],
  providers: [AttendanceCvService, CloudinaryStorageProvider],
})
export class AttendanceCvModule {}
