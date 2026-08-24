import { Module } from '@nestjs/common';
import { PrincipalHigherEducationModule } from 'src/modules/principal/higher-education/higher-education.module';
import { IqacHigherEducationController } from './iqac-higher-education.controller';

@Module({
  imports: [PrincipalHigherEducationModule],
  controllers: [IqacHigherEducationController],
})
export class IqacHigherEducationModule {}
