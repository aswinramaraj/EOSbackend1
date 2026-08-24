import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';
import { CertificateRequestsService } from './certificate-requests.service';
import { ListCertificateRequestsQueryDto } from './dto/list-certificate-requests-query.dto';
import { CreateCertificateRequestDto } from './dto/create-certificate-request.dto';
import { UpdateCertificateStatusDto } from './dto/update-certificate-status.dto';
import { UpdateCertificateFeeDto } from './dto/update-certificate-fee.dto';

@Controller('certificate-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class CertificateRequestsController {
  constructor(private readonly service: CertificateRequestsService) {}

  @Get('stats')
  async getStats() {
    const stats = await this.service.getStats();
    return ApiResponse.ok(stats, 'Certificate request stats fetched successfully.');
  }

  @Get('types')
  async listTypes() {
    const types = await this.service.listCertificateTypes();
    return ApiResponse.ok(types, 'Certificate types fetched successfully.');
  }

  @Get()
  async findAll(@Query() query: ListCertificateRequestsQueryDto) {
    const requests = await this.service.findAll(query);
    return ApiResponse.ok(requests, 'Certificate requests fetched successfully.');
  }

  @Post()
  async create(@Body() dto: CreateCertificateRequestDto) {
    const request = await this.service.create(dto);
    return ApiResponse.created(request, 'Certificate request created successfully.');
  }

  @Patch(':id/status')
  async updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCertificateStatusDto) {
    const request = await this.service.updateStatus(id, dto);
    return ApiResponse.ok(request, 'Certificate request status updated successfully.');
  }

  @Patch(':id/fee')
  async updateFee(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCertificateFeeDto) {
    const request = await this.service.updateFee(id, dto);
    return ApiResponse.ok(request, 'Certificate request fee updated successfully.');
  }
}
