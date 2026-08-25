import { Module } from '@nestjs/common';
import { PrincipalFacultyModule } from 'src/modules/principal/faculty/faculty.module';
import { IqacFacultyController } from './iqac-faculty.controller';

@Module({
  imports: [PrincipalFacultyModule],
  controllers: [IqacFacultyController],
})
export class IqacFacultyModule {}
