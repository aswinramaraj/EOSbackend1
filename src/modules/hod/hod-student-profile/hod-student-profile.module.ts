import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodStudentProfileService } from './hod-student-profile.service';
import { HodStudentProfileController } from './hod-student-profile.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodStudentProfileController],
  providers: [HodStudentProfileService],
})
export class HodStudentProfileModule {}
