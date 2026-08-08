import { Module } from '@nestjs/common';
import { FacultyVerificationController } from './faculty-verification.controller';
import { FacultyVerificationService } from './faculty-verification.service';

@Module({
  controllers: [FacultyVerificationController],
  providers: [FacultyVerificationService],
})
export class FacultyVerificationModule {}
