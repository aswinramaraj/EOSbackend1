import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications/notifications.module';
import { ProductRequestsService } from './product-requests.service';
import { ProductRequestsController } from './product-requests.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ProductRequestsController],
  providers: [ProductRequestsService],
})
export class ProductRequestsModule {}
