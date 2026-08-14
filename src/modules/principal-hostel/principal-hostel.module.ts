import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalHostelController } from './principal-hostel.controller';
import { PrincipalHostelService } from './principal-hostel.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalHostelController],
  providers: [PrincipalHostelService],
})
export class PrincipalHostelModule {}
