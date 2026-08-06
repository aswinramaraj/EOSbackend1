import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Shared by revaluation-requests and photocopy-requests student-facing
 * create endpoints — both are gated by the same per-exam window/fee config.
 */
export async function getOpenRevaluationWindow(
  prisma: PrismaService,
  examId: number,
  kind: 'reval' | 'photocopy',
) {
  const window = await prisma.revaluation_windows.findUnique({
    where: { exam_id: examId },
  });

  if (!window || !window.is_open) {
    throw new ConflictException({
      message: 'The revaluation/photocopy window is not open for this exam.',
      errorCode: 'WINDOW_CLOSED',
    });
  }

  if (kind === 'reval' && window.application_type === 'photocopy_only') {
    throw new ForbiddenException({
      message: 'This exam only accepts photocopy requests, not revaluation.',
      errorCode: 'REVALUATION_NOT_ALLOWED',
    });
  }
  if (kind === 'photocopy' && window.application_type === 'reval_only') {
    throw new ForbiddenException({
      message: 'This exam only accepts revaluation requests, not photocopies.',
      errorCode: 'PHOTOCOPY_NOT_ALLOWED',
    });
  }

  const now = new Date();
  if (window.opens_at && now < window.opens_at) {
    throw new ConflictException({
      message: 'The application window has not opened yet.',
      errorCode: 'WINDOW_NOT_YET_OPEN',
    });
  }
  if (window.closes_at && now > window.closes_at) {
    throw new ConflictException({
      message: 'The application window has closed.',
      errorCode: 'WINDOW_CLOSED',
    });
  }

  return window;
}
