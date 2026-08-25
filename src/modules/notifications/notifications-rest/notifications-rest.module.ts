import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsRestService } from './notifications-rest.service';
import { NotificationsRestController } from './notifications-rest.controller';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsRestController],
  providers: [NotificationsRestService],
})
export class NotificationsRestModule {}
