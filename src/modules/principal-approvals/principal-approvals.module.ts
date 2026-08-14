import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalApprovalsController } from './principal-approvals.controller';
import { PrincipalApprovalsService } from './principal-approvals.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalApprovalsController],
  providers: [PrincipalApprovalsService],
})
export class PrincipalApprovalsModule {}
