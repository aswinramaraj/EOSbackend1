import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyLookupController } from './faculty-lookup.controller';
import { FacultyLookupService } from './faculty-lookup.service';

@Module({
  imports: [PrismaModule],
  controllers: [FacultyLookupController],
  providers: [FacultyLookupService],
})
export class FacultyLookupModule {}
