import { Module } from '@nestjs/common';
import { BorrowRequestsController } from './borrow-requests.controller';
import { BorrowRequestsService } from './borrow-requests.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { BorrowRecordsModule } from '../borrow-records/borrow-records.module';

@Module({
  imports: [PrismaModule, BorrowRecordsModule],
  controllers: [BorrowRequestsController],
  providers: [BorrowRequestsService],
})
export class BorrowRequestsModule {}
