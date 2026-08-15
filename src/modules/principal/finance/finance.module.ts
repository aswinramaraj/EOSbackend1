import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalFinanceController } from './finance.controller';
import { PrincipalFinanceService } from './finance.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalFinanceController],
  providers: [PrincipalFinanceService],
})
export class PrincipalFinanceModule {}
