import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { BorrowRecordsModule } from 'src/modules/library/borrow-records/borrow-records.module';
import { LibrarySettingsModule } from 'src/modules/library/settings/settings.module';
import { HodEmployeeLibraryService } from './hod-employee-library.service';
import { HodEmployeeLibraryController } from './hod-employee-library.controller';

@Module({
  imports: [PrismaModule, BorrowRecordsModule, LibrarySettingsModule],
  controllers: [HodEmployeeLibraryController],
  providers: [HodEmployeeLibraryService],
})
export class HodEmployeeLibraryModule {}
