import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalFinanceController } from './principal-finance.controller';
import { PrincipalFinanceService } from './principal-finance.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalFinanceController],
  providers: [PrincipalFinanceService],
})
export class PrincipalFinanceModule {}
