import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalLibraryController } from './principal-library.controller';
import { PrincipalLibraryService } from './principal-library.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalLibraryController],
  providers: [PrincipalLibraryService],
})
export class PrincipalLibraryModule {}
