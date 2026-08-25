import { Module } from '@nestjs/common';
import { PrincipalEdcModule } from 'src/modules/principal/edc/edc.module';
import { IqacEdcController } from './iqac-edc.controller';

@Module({
  imports: [PrincipalEdcModule],
  controllers: [IqacEdcController],
})
export class IqacEdcModule {}
