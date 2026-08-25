import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { SpecialAdmissionsService } from './special-admissions.service';
import { SpecialAdmissionsController } from './special-admissions.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [SpecialAdmissionsController],
  providers: [SpecialAdmissionsService],
})
export class SpecialAdmissionsModule {}
