import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalHostelController } from './hostel.controller';
import { PrincipalHostelService } from './hostel.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalHostelController],
  providers: [PrincipalHostelService],
})
export class PrincipalHostelModule {}
