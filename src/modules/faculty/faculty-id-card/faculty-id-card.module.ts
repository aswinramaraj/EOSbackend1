import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyIdCardService } from './faculty-id-card.service';
import { FacultyIdCardController } from './faculty-id-card.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FacultyIdCardController],
  providers: [FacultyIdCardService],
})
export class FacultyIdCardModule {}
