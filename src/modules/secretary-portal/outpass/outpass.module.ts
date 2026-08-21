import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { OutpassController } from './outpass.controller';
import { OutpassService } from './outpass.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [OutpassController],
  providers: [OutpassService],
})
export class OutpassModule {}
