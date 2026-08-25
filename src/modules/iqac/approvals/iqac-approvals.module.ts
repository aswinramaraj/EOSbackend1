import { Module } from '@nestjs/common';
import { DocumentsModule } from 'src/modules/secretary-portal/documents/documents.module';
import { IqacApprovalsController } from './iqac-approvals.controller';
import { IqacApprovalsService } from './iqac-approvals.service';

@Module({
  imports: [DocumentsModule],
  controllers: [IqacApprovalsController],
  providers: [IqacApprovalsService],
})
export class IqacApprovalsModule {}
