import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalApprovalsController } from './approvals.controller';
import { PrincipalApprovalsService } from './approvals.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalApprovalsController],
  providers: [PrincipalApprovalsService],
  exports: [PrincipalApprovalsService],
})
export class PrincipalApprovalsModule {}
