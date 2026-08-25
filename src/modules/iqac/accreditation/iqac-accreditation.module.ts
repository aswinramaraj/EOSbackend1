import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccreditationModule } from 'src/modules/secretary-portal/accreditation/accreditation.module';
import { IqacAccreditationController } from './iqac-accreditation.controller';
import { IqacAccreditationService } from './iqac-accreditation.service';

@Module({
  imports: [PrismaModule, AccreditationModule],
  controllers: [IqacAccreditationController],
  providers: [IqacAccreditationService],
  exports: [IqacAccreditationService],
})
export class IqacAccreditationModule {}
