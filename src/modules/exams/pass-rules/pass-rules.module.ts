import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PassRulesService } from './pass-rules.service';
import { PassRulesController } from './pass-rules.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PassRulesController],
  providers: [PassRulesService],
})
export class PassRulesModule {}
