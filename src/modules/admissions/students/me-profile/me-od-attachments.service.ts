import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/modules/storage/storage.service';
import { UploadOdAttachmentDto } from './dto/upload-od-attachment.dto';

interface OdAttachmentFiles {
  photo?: Array<Express.Multer.File>;
  certificate?: Array<Express.Multer.File>;
}

/**
 * Fills the IQAC admin portal's "geo-tagged photo" / "certificate" fields on
 * od_requests, which had no upload path at all before this - kept as its
 * own file rather than folded into MeOdTeamsService (already 600+ lines)
 * or MeOdRequestsService (read-only), matching this folder's one-concern-
 * per-file convention (me-od-teams-list.service.ts vs me-od-teams.service.ts).
 */
@Injectable()
export class MeOdAttachmentsService {
  private readonly logger = new Logger(MeOdAttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * POST /me/od-requests/:id/attachments — any member of the request's team
   * (the event's photo/certificate belong to the whole team, not just its
   * creator - unlike submitOdRequest, which is creator-only).
   */
  async upload(
    requestId: number,
    userId: number,
    dto: UploadOdAttachmentDto,
    files: OdAttachmentFiles,
  ) {
    const caller = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!caller) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const request = await this.prisma.od_requests.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        od_teams: { select: { od_team_members: { select: { student_id: true } } } },
      },
    });
    if (!request) {
      throw new NotFoundException({
        message: 'OD request not found',
        errorCode: 'OD_REQUEST_NOT_FOUND',
      });
    }

    const isMember = request.od_teams.od_team_members.some(
      (m) => m.student_id === caller.id,
    );
    if (!isMember) {
      throw new ForbiddenException({
        message: 'You may only attach files to a request for your own team',
        errorCode: 'NOT_TEAM_MEMBER',
      });
    }

    const data: Record<string, unknown> = {};

    if (files.photo?.[0]) {
      const file = files.photo[0];
      const path = `od-requests/${requestId}/photo-${Date.now()}-${file.originalname}`;
      const { url } = await this.storage.upload(file.buffer, path, file.mimetype);
      data.photo_url = url;
      data.photo_uploaded_at = new Date();
    }

    if (files.certificate?.[0]) {
      const file = files.certificate[0];
      const path = `od-requests/${requestId}/certificate-${Date.now()}-${file.originalname}`;
      const { url } = await this.storage.upload(file.buffer, path, file.mimetype);
      data.certificate_url = url;
      data.certificate_uploaded_at = new Date();
    }

    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;

    if (Object.keys(data).length > 0) {
      data.verification_status = 'under_review';
    }

    const updated = await this.prisma.od_requests.update({
      where: { id: requestId },
      data,
      select: {
        id: true,
        photo_url: true,
        photo_uploaded_at: true,
        certificate_url: true,
        certificate_uploaded_at: true,
        latitude: true,
        longitude: true,
        verification_status: true,
      },
    });

    this.logger.log(`OD request ${requestId} attachments updated by student=${caller.id}`);
    return updated;
  }
}
