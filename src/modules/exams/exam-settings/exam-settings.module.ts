import { Module } from '@nestjs/common';
import { ExamSettingsService } from './exam-settings.service';
import { ExamSettingsController } from './exam-settings.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ExamSettingsController],
  providers: [ExamSettingsService],
})
export class ExamSettingsModule {}
