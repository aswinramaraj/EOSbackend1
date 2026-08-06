import { ConflictException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

export type ExamSession = 'FN' | 'AN';

/** FN = 00:00-12:00, AN = 12:00-23:59:59.999, both on examDate, in UTC. */
function sessionWindow(examDate: Date, session: ExamSession) {
  const day = new Date(examDate);
  day.setUTCHours(0, 0, 0, 0);
  const start = new Date(day);
  const end = new Date(day);
  if (session === 'FN') {
    end.setUTCHours(12, 0, 0, 0);
  } else {
    start.setUTCHours(12, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);
  }
  return { start, end };
}

/**
 * Checks a venue against two independent commitment sources that don't
 * cross-check each other today: other PUBLISHED exam_timetable slots (this
 * module and hall-plans in Phase 4 both call this), and approved
 * venue_bookings (the generic institutional booking flow — IQAC-approved,
 * COE has no visibility into it otherwise). Throws 409 on either clash.
 */
export async function assertVenueNotClashing(
  prisma: PrismaService,
  params: {
    venueId: number;
    examDate: Date;
    session: ExamSession;
    excludeExamTimetableId?: number;
  },
): Promise<void> {
  const { venueId, examDate, session, excludeExamTimetableId } = params;

  const clashingSlot = await prisma.exam_timetable.findFirst({
    where: {
      venue_id: venueId,
      exam_date: examDate,
      session,
      id: excludeExamTimetableId ? { not: excludeExamTimetableId } : undefined,
      exam_timetable_versions: { status: 'published' },
    },
  });

  if (clashingSlot) {
    throw new ConflictException({
      message:
        'This venue is already booked for another published exam at the same date and session.',
      errorCode: 'VENUE_ALREADY_BOOKED',
    });
  }

  const { start, end } = sessionWindow(examDate, session);

  const clashingBooking = await prisma.venue_bookings.findFirst({
    where: {
      venue_id: venueId,
      status: 'approved',
      from_datetime: { lt: end },
      to_datetime: { gt: start },
    },
  });

  if (clashingBooking) {
    throw new ConflictException({
      message:
        'This venue already has an approved institutional booking at that time.',
      errorCode: 'VENUE_ALREADY_BOOKED',
    });
  }
}
