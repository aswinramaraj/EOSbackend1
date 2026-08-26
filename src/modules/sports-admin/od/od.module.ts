import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { OdService } from './od.service';
import { OdController } from './od.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [OdController],
  providers: [OdService],
  exports: [OdService],
})
export class OdModule {}
