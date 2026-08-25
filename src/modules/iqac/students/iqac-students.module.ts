import { Module } from '@nestjs/common';
import { PrincipalStudentsModule } from 'src/modules/principal/students/students.module';
import { IqacStudentsController } from './iqac-students.controller';

@Module({
  imports: [PrincipalStudentsModule],
  controllers: [IqacStudentsController],
})
export class IqacStudentsModule {}
