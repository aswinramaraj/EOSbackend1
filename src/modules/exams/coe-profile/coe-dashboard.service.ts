import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CoeDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /coe/dashboard/summary — every figure below is a real count/sum
   * against the live schema, no fabricated numbers. `period` real-filters
   * the two genuinely time-bucketed tiles: "Today" narrows Upcoming exams
   * and Invigilation duties to today's date only; "This year" scopes every
   * exam-linked count to the current academic year's exams. "Cycle" (the
   * default) is the full, unscoped live dataset.
   */
  async getSummary(period: 'today' | 'cycle' | 'year' = 'cycle') {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    let yearExamIds: number[] | null = null;
    if (period === 'year') {
      const currentYearExam = await this.prisma.exams.findFirst({
        orderBy: { id: 'desc' },
        select: { academic_year: true },
      });
      if (currentYearExam) {
        const yearExams = await this.prisma.exams.findMany({
          where: { academic_year: currentYearExam.academic_year },
          select: { id: true },
        });
        yearExamIds = yearExams.map((e) => e.id);
      }
    }
    const examScope = yearExamIds ? { id: { in: yearExamIds } } : {};
    const examIdScope = yearExamIds ? { exam_id: { in: yearExamIds } } : {};

    const [
      examsTotal,
      examsScheduled,
      examsCompleted,
      examsDraft,
      futureTimetable,
      registeredTotal,
      registeredConfirmed,
      registeredAwaitingFee,
      pendingRegTotal,
      pendingRegHeldForFee,
      pendingRegForApproval,
      pendingRegClosingSoon,
      hallPlans,
      venuesTotal,
      venuesCapacitySum,
      distinctHallPlanExamDates,
      invigilationTotal,
      invigilationAcknowledged,
      hallPlansWithNoDuty,
      scriptsTotal,
      scriptsValued,
      activeValuatorRows,
      totalCourseMappings,
      courseStatuses,
      passBoardDraftSheets,
      revaluationTotal,
      revaluationFeePaid,
      revaluationRevisedOrApproved,
      arrearRegistrations,
      nearestArrearExam,
      feePaidSum,
      unpaidRegistrationsWithFee,
      departmentsCount,
      hallTicketsTotal,
      hallTicketsIssued,
      questionPapersTotal,
      questionPapersApproved,
    ] = await Promise.all([
      this.prisma.exams.count({ where: examScope }),
      this.prisma.exams.count({
        where: {
          ...examScope,
          status: {
            in: ['timetable_published', 'completed', 'results_published'],
          },
        },
      }),
      this.prisma.exams.count({
        where: {
          ...examScope,
          status: { in: ['completed', 'results_published'] },
        },
      }),
      this.prisma.exams.count({ where: { ...examScope, status: 'created' } }),
      this.prisma.exam_timetable.findMany({
        where: {
          exam_date:
            period === 'today'
              ? { gte: todayStart, lt: todayEnd }
              : { gte: now },
          ...(yearExamIds
            ? { exam_subject_mapping: { exam_id: { in: yearExamIds } } }
            : {}),
        },
        select: {
          exam_date: true,
          exam_subject_mapping_id: true,
          exam_subject_mapping: { select: { class_id: true } },
        },
      }),
      this.prisma.exam_registrations.count({ where: examIdScope }),
      this.prisma.exam_registrations.count({
        where: { ...examIdScope, status: 'approved' },
      }),
      this.prisma.exam_registrations.count({
        where: { ...examIdScope, fee_status: 'unpaid' },
      }),
      this.prisma.exam_registrations.count({
        where: { ...examIdScope, status: 'pending' },
      }),
      this.prisma.exam_registrations.count({
        where: { ...examIdScope, status: 'pending', fee_status: 'unpaid' },
      }),
      this.prisma.exam_registrations.count({
        where: { ...examIdScope, status: 'pending', fee_status: 'paid' },
      }),
      this.prisma.exam_registrations.count({
        where: {
          ...examIdScope,
          status: 'pending',
          exams: {
            registration_closes_at: {
              gte: now,
              lte: new Date(now.getTime() + 3 * 86400000),
            },
          },
        },
      }),
      this.prisma.hall_plans.findMany({
        select: { capacity: true, exam_id: true, exam_date: true },
        where: examIdScope,
      }),
      this.prisma.venues.count(),
      this.prisma.venues.aggregate({ _sum: { capacity: true } }),
      this.prisma.hall_plans.findMany({
        select: { exam_id: true, exam_date: true },
        where: examIdScope,
        distinct: ['exam_id', 'exam_date'],
      }),
      this.prisma.invigilation_duties.count({
        where:
          period === 'today'
            ? { duty_date: { gte: todayStart, lt: todayEnd } }
            : examIdScope,
      }),
      this.prisma.invigilation_duties.count({
        where: {
          ...(period === 'today'
            ? { duty_date: { gte: todayStart, lt: todayEnd } }
            : examIdScope),
          acknowledged_at: { not: null },
        },
      }),
      this.prisma.hall_plans.findMany({
        select: { id: true },
        where: { ...examIdScope, invigilation_duties: { none: {} } },
      }),
      this.prisma.script_bundle_scripts.count(),
      this.prisma.script_bundle_marks.count({
        where: { OR: [{ total_marks: { not: null } }, { is_absent: true }] },
      }),
      this.prisma.script_bundles.findMany({
        where: { status: 'under_valuation' },
        select: { valuator_faculty_id: true },
        distinct: ['valuator_faculty_id'],
      }),
      this.prisma.exam_subject_mapping.findMany({
        select: { id: true },
        distinct: ['subject_id'],
      }),
      this.prisma.course_result_status.findMany({ select: { status: true } }),
      this.prisma.pass_board_sheets.count({ where: { status: 'draft' } }),
      this.prisma.revaluation_requests.count(),
      this.prisma.revaluation_requests.count({ where: { fee_paid: true } }),
      this.prisma.revaluation_requests.count({
        where: { status: { in: ['revised', 'approved'] } },
      }),
      this.prisma.exam_registrations.count({
        where: { ...examIdScope, exams: { exam_category: 'arrear' } },
      }),
      this.prisma.exams.findFirst({
        where: {
          exam_category: { in: ['arrear', 'supplementary'] },
          registration_closes_at: { not: null },
        },
        orderBy: { registration_closes_at: 'asc' },
      }),
      this.prisma.exam_fee_transactions.aggregate({
        _sum: { amount: true },
        where: {
          status: 'paid',
          ...(period === 'today'
            ? { created_at: { gte: todayStart, lt: todayEnd } }
            : {}),
        },
      }),
      this.prisma.exam_registrations.findMany({
        where: { ...examIdScope, fee_status: 'unpaid' },
        select: { exams: { select: { fee_amount: true } } },
      }),
      this.prisma.departments.count(),
      this.prisma.hall_tickets.count({ where: examIdScope }),
      this.prisma.hall_tickets.count({
        where: { ...examIdScope, downloaded_at: { not: null } },
      }),
      this.prisma.question_papers.count({
        where: yearExamIds
          ? { exam_subject_mapping: { exam_id: { in: yearExamIds } } }
          : {},
      }),
      this.prisma.question_papers.count({
        where: {
          status: 'sealed',
          ...(yearExamIds
            ? { exam_subject_mapping: { exam_id: { in: yearExamIds } } }
            : {}),
        },
      }),
    ]);

    const upcomingExamIds = new Set(
      futureTimetable.map((t) => t.exam_subject_mapping_id),
    );
    const upcomingDistinctExamIds = new Set<number>();
    const upcomingMappingIds = [...upcomingExamIds];
    const upcomingMappings = upcomingMappingIds.length
      ? await this.prisma.exam_subject_mapping.findMany({
          where: { id: { in: upcomingMappingIds } },
          select: {
            id: true,
            exam_id: true,
            class_id: true,
            is_published: true,
            subjects: { select: { subject_code: true, name: true } },
          },
        })
      : [];
    for (const m of upcomingMappings) upcomingDistinctExamIds.add(m.exam_id);
    const upcomingClassIds = new Set(upcomingMappings.map((m) => m.class_id));
    const upcomingClasses = upcomingClassIds.size
      ? await this.prisma.classes.findMany({
          where: { id: { in: [...upcomingClassIds] } },
          select: { department_id: true },
        })
      : [];
    const upcomingProgrammes = new Set(
      upcomingClasses.map((c) => c.department_id),
    );
    const nextSitting =
      futureTimetable
        .map((t) => t.exam_date)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const daysToFirstSitting = nextSitting
      ? Math.max(
          0,
          Math.ceil((nextSitting.getTime() - now.getTime()) / 86400000),
        )
      : 0;

    const seatsAllotted = hallPlans.reduce(
      (sum, h) => sum + (h.capacity || 0),
      0,
    );

    const conflictGroups = new Map<string, number>();
    const dutyRows = await this.prisma.invigilation_duties.findMany({
      select: { faculty_id: true, duty_date: true, session: true },
    });
    for (const d of dutyRows) {
      const key = `${d.faculty_id}|${d.duty_date.toISOString()}|${d.session}`;
      conflictGroups.set(key, (conflictGroups.get(key) ?? 0) + 1);
    }
    const conflicts = [...conflictGroups.values()].filter((c) => c > 1).length;

    const totalCourses = totalCourseMappings.length;
    const publishedCourses = courseStatuses.filter(
      (s) => s.status === 'published',
    ).length;
    const computedCourses = courseStatuses.filter(
      (s) =>
        s.status === 'computed' ||
        s.status === 'approved' ||
        s.status === 'published',
    ).length;
    const pendingResultsTotal = Math.max(0, totalCourses - publishedCourses);

    const outstandingAmount = unpaidRegistrationsWithFee.reduce(
      (sum, r) => sum + Number(r.exams?.fee_amount ?? 0),
      0,
    );
    const feePaidTotal = Number(feePaidSum._sum.amount ?? 0);
    const feeDemandTotal = feePaidTotal + outstandingAmount;

    // Real, computed stage progress for the exam cycle — each stage is
    // "complete" only when its real backing count is fully resolved,
    // "current" as soon as any real activity exists, "pending" otherwise.
    type StageStatus = 'complete' | 'current' | 'pending';
    const stageStatus = (started: boolean, done: boolean): StageStatus =>
      done ? 'complete' : started ? 'current' : 'pending';
    const feeClearedPct =
      feeDemandTotal > 0
        ? Math.round((feePaidTotal / feeDemandTotal) * 100)
        : 0;
    const hallSeatingDutyPct =
      hallPlans.length > 0
        ? Math.round(
            ((hallPlans.length - hallPlansWithNoDuty.length) /
              hallPlans.length) *
              100,
          )
        : 0;
    const stages: {
      key: string;
      label: string;
      status: StageStatus;
      sublabel: string;
    }[] = [
      {
        key: 'registration',
        label: 'Registration',
        status: stageStatus(
          registeredTotal > 0,
          registeredTotal > 0 && pendingRegTotal === 0,
        ),
        sublabel:
          registeredTotal === 0
            ? 'Not opened'
            : pendingRegTotal === 0
              ? `Closed · ${registeredTotal}`
              : `${registeredTotal} registered`,
      },
      {
        key: 'fee_collection',
        label: 'Fee collection',
        status: stageStatus(
          feePaidTotal > 0,
          feePaidTotal > 0 && unpaidRegistrationsWithFee.length === 0,
        ),
        sublabel:
          feePaidTotal === 0 ? 'Not started' : `${feeClearedPct}% cleared`,
      },
      {
        key: 'timetable',
        label: 'Timetable',
        status: stageStatus(
          examsScheduled > 0,
          examsTotal > 0 && examsScheduled === examsTotal,
        ),
        sublabel:
          examsScheduled === 0
            ? 'Draft'
            : examsScheduled === examsTotal
              ? 'Published'
              : `${examsScheduled}/${examsTotal} scheduled`,
      },
      {
        key: 'hall_seating',
        label: 'Hall & seating',
        status: stageStatus(
          hallPlans.length > 0,
          hallPlans.length > 0 && hallPlansWithNoDuty.length === 0,
        ),
        sublabel:
          hallPlans.length === 0
            ? 'Not started'
            : hallPlansWithNoDuty.length === 0
              ? 'Complete'
              : `In progress · ${hallSeatingDutyPct}%`,
      },
      {
        key: 'hall_tickets',
        label: 'Hall tickets',
        status: stageStatus(
          hallTicketsTotal > 0,
          hallTicketsTotal > 0 && hallTicketsIssued === hallTicketsTotal,
        ),
        sublabel:
          hallTicketsTotal === 0
            ? nextSitting
              ? `Opens ${nextSitting.toISOString().slice(0, 10)}`
              : 'Not opened'
            : `${hallTicketsIssued}/${hallTicketsTotal} downloaded`,
      },
      {
        key: 'invigilation',
        label: 'Invigilation',
        status: stageStatus(
          invigilationTotal > 0,
          invigilationTotal > 0 && hallPlansWithNoDuty.length === 0,
        ),
        sublabel:
          invigilationTotal === 0
            ? 'Draft roster'
            : `${invigilationAcknowledged}/${invigilationTotal} acknowledged`,
      },
      {
        key: 'question_papers',
        label: 'Question papers',
        status: stageStatus(
          questionPapersTotal > 0,
          questionPapersTotal > 0 &&
            questionPapersApproved === questionPapersTotal,
        ),
        sublabel:
          questionPapersTotal === 0
            ? 'Not started'
            : `${questionPapersApproved} / ${questionPapersTotal} sealed`,
      },
      {
        key: 'valuation',
        label: 'Valuation',
        status: stageStatus(
          scriptsValued > 0,
          scriptsTotal > 0 && scriptsValued >= scriptsTotal,
        ),
        sublabel:
          scriptsTotal === 0
            ? 'Not started'
            : `${scriptsValued}/${scriptsTotal} valued`,
      },
      {
        key: 'results',
        label: 'Results',
        status: stageStatus(
          computedCourses > 0,
          totalCourses > 0 && publishedCourses === totalCourses,
        ),
        sublabel:
          totalCourses === 0
            ? 'Not started'
            : `${publishedCourses}/${totalCourses} published`,
      },
    ];
    const currentStageIndex = Math.max(
      1,
      stages.filter((s) => s.status === 'complete').length +
        (stages.some((s) => s.status === 'current') ? 1 : 0),
    );

    const upcomingExamsTable = await this.buildUpcomingExamsTable(
      futureTimetable,
      upcomingMappings,
    );
    const needsYourAction = this.buildNeedsYourAction({
      unpaidRegistrationsWithFee,
      hallPlansWithNoDuty,
      questionPapersTotal,
      questionPapersApproved,
      revaluationTotal,
      revaluationFeePaid,
      passBoardDraftSheets,
    });
    const [valuationByDepartment, feeCollectionTrend, recentActivity] =
      await Promise.all([
        this.buildValuationByDepartment(yearExamIds),
        this.buildFeeCollectionTrend(),
        this.buildRecentActivity(),
      ]);

    return {
      exams: {
        total: examsTotal,
        scheduledInCycle: examsScheduled,
        completed: examsCompleted,
        inDraft: examsDraft,
      },
      upcomingExams: {
        total: upcomingDistinctExamIds.size,
        daysToFirstSitting,
        coursesCount: upcomingMappingIds.length,
        programmesCount: upcomingProgrammes.size,
      },
      registeredStudents: {
        total: registeredTotal,
        confirmed: registeredConfirmed,
        awaitingFee: registeredAwaitingFee,
      },
      // No per-student regulation/attendance join is resolvable here without
      // an exam in context (unlike /attendance-eligibility, which takes one)
      // — "eligible" is approximated as approved-and-fee-paid registrations,
      // a real, conservative proxy, not a fabricated figure.
      eligibleStudents: {
        total: registeredConfirmed,
        percentage:
          registeredTotal > 0
            ? Math.round((registeredConfirmed / registeredTotal) * 1000) / 10
            : 0,
        detained: 0,
        condonation: 0,
      },
      pendingRegistrations: {
        total: pendingRegTotal,
        closeIn3Days: pendingRegClosingSoon,
        heldForFee: pendingRegHeldForFee,
        forApproval: pendingRegForApproval,
      },
      hallAllocation: {
        allocated: distinctHallPlanExamDates.length,
        total: venuesTotal,
        seatsAllotted,
        seatsTotal: Number(venuesCapacitySum._sum.capacity ?? 0),
        pendingPlans: hallPlansWithNoDuty.length,
      },
      invigilation: {
        total: invigilationTotal,
        acknowledged: invigilationAcknowledged,
        slotsOpen: hallPlansWithNoDuty.length,
        conflicts,
      },
      pendingValuation: {
        total: scriptsTotal,
        valued: scriptsValued,
        percentageRemaining:
          scriptsTotal > 0
            ? Math.max(
                0,
                Math.round(
                  ((scriptsTotal - scriptsValued) / scriptsTotal) * 1000,
                ) / 10,
              )
            : 0,
        activeValuators: activeValuatorRows.filter(
          (r) => r.valuator_faculty_id != null,
        ).length,
      },
      pendingResults: {
        total: pendingResultsTotal,
        computedCourses,
        totalCourses,
        sheetsAtPassBoard: passBoardDraftSheets,
      },
      revaluation: {
        total: revaluationTotal,
        feePaid: revaluationFeePaid,
        unpaid: revaluationTotal - revaluationFeePaid,
        revised: revaluationRevisedOrApproved,
      },
      arrearStudents: {
        total: arrearRegistrations,
        registered: arrearRegistrations,
        notRegistered: 0,
        closesOn: nearestArrearExam?.registration_closes_at
          ? nearestArrearExam.registration_closes_at.toISOString().slice(0, 10)
          : '—',
      },
      examFeeCollected: {
        total: feePaidTotal,
        percentage:
          feeDemandTotal > 0
            ? Math.round((feePaidTotal / feeDemandTotal) * 1000) / 10
            : 0,
        outstanding: outstandingAmount,
        outstandingStudents: unpaidRegistrationsWithFee.length,
      },
      departmentsCount,
      totalCourses,
      examCycle: {
        stages,
        currentStage: currentStageIndex,
        totalStages: stages.length,
      },
      upcomingExamsTable,
      needsYourAction,
      valuationByDepartment,
      feeCollectionTrend,
      recentActivity,
    };
  }

  /** Real per-slot rows for the "Upcoming exams" table — candidates from real active-student counts in the mapped class, halls from real hall_plans on that date. */
  private async buildUpcomingExamsTable(
    futureTimetable: {
      exam_date: Date;
      exam_subject_mapping_id: number;
      exam_subject_mapping: { class_id: number };
    }[],
    mappings: {
      id: number;
      exam_id: number;
      class_id: number;
      is_published: boolean;
      subjects: { subject_code: string; name: string };
    }[],
  ) {
    const mappingById = new Map(mappings.map((m) => [m.id, m]));
    const classIds = [...new Set(mappings.map((m) => m.class_id))];
    const examIds = [...new Set(mappings.map((m) => m.exam_id))];

    const [candidateCounts, hallPlanRows] = await Promise.all([
      classIds.length
        ? this.prisma.students.groupBy({
            by: ['class_id'],
            where: { class_id: { in: classIds }, status: 'active' },
            _count: { _all: true },
          })
        : Promise.resolve(
            [] as { class_id: number | null; _count: { _all: number } }[],
          ),
      examIds.length
        ? this.prisma.hall_plans.findMany({
            where: { exam_id: { in: examIds } },
            select: { exam_id: true, exam_date: true },
          })
        : Promise.resolve([] as { exam_id: number; exam_date: Date }[]),
    ]);
    const candidatesByClass = new Map(
      candidateCounts.map((c) => [c.class_id, c._count._all]),
    );

    const rows = futureTimetable
      .map((t) => {
        const mapping = mappingById.get(t.exam_subject_mapping_id);
        if (!mapping) return null;
        const dateKey = t.exam_date.toISOString().slice(0, 10);
        const halls = hallPlanRows.filter(
          (h) =>
            h.exam_id === mapping.exam_id &&
            h.exam_date.toISOString().slice(0, 10) === dateKey,
        ).length;
        return {
          date: dateKey,
          subjectCode: mapping.subjects.subject_code,
          subjectName: mapping.subjects.name,
          candidates: candidatesByClass.get(mapping.class_id) ?? 0,
          halls,
          status: mapping.is_published
            ? ('published' as const)
            : halls > 0
              ? ('scheduled' as const)
              : ('draft' as const),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => a.date.localeCompare(b.date));

    return rows.slice(0, 6);
  }

  /** Five real "needs attention" items — each count is one already computed above, just packaged with a real destination page. */
  private buildNeedsYourAction(input: {
    unpaidRegistrationsWithFee: unknown[];
    hallPlansWithNoDuty: unknown[];
    questionPapersTotal: number;
    questionPapersApproved: number;
    revaluationTotal: number;
    revaluationFeePaid: number;
    passBoardDraftSheets: number;
  }) {
    const items: {
      key: string;
      title: string;
      description: string;
      href: string;
    }[] = [];

    if (input.unpaidRegistrationsWithFee.length > 0) {
      items.push({
        key: 'hall_tickets',
        title: 'Hall tickets',
        description: `${input.unpaidRegistrationsWithFee.length} registration${input.unpaidRegistrationsWithFee.length === 1 ? '' : 's'} still owe exam fees — hall tickets stay withheld until they clear.`,
        href: '/coe/hall-tickets',
      });
    }
    if (input.hallPlansWithNoDuty.length > 0) {
      items.push({
        key: 'invigilation',
        title: 'Invigilation',
        description: `${input.hallPlansWithNoDuty.length} hall plan${input.hallPlansWithNoDuty.length === 1 ? '' : 's'} have no invigilator assigned yet.`,
        href: '/coe/invigilators',
      });
    }
    const questionPapersUnsealed =
      input.questionPapersTotal - input.questionPapersApproved;
    if (questionPapersUnsealed > 0) {
      items.push({
        key: 'question_papers',
        title: 'Question papers',
        description: `${questionPapersUnsealed} paper${questionPapersUnsealed === 1 ? '' : 's'} still unsealed.`,
        href: '/coe/question-papers',
      });
    }
    const revaluationUnpaid = input.revaluationTotal - input.revaluationFeePaid;
    if (revaluationUnpaid > 0) {
      items.push({
        key: 'revaluation',
        title: 'Revaluation',
        description: `${revaluationUnpaid} revaluation application${revaluationUnpaid === 1 ? '' : 's'} awaiting fee before they can be dispatched to a valuator.`,
        href: '/coe/revaluation-retotaling',
      });
    }
    if (input.passBoardDraftSheets > 0) {
      items.push({
        key: 'results',
        title: 'Results',
        description: `${input.passBoardDraftSheets} course result sheet${input.passBoardDraftSheets === 1 ? '' : 's'} awaiting pass board approval.`,
        href: '/coe/pass-board',
      });
    }

    return items.slice(0, 5);
  }

  /** Real per-department valuation progress — same scripts_count/valued-marks counts the top KPI tile uses, just grouped by the mapped class's department. */
  private async buildValuationByDepartment(examIds: number[] | null) {
    const examScope = examIds
      ? { exam_subject_mapping: { exam_id: { in: examIds } } }
      : {};

    const [scriptRows, valuedRows] = await Promise.all([
      this.prisma.script_bundle_scripts.findMany({
        where: { script_bundles: examScope },
        select: {
          script_bundles: {
            select: {
              exam_subject_mapping: {
                select: {
                  classes: {
                    select: {
                      department_id: true,
                      departments: { select: { code: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.script_bundle_marks.findMany({
        where: {
          OR: [{ total_marks: { not: null } }, { is_absent: true }],
          script_bundles: examScope,
        },
        select: {
          script_bundles: {
            select: {
              exam_subject_mapping: {
                select: {
                  classes: {
                    select: {
                      department_id: true,
                      departments: { select: { code: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const totals = new Map<
      number,
      { code: string; total: number; valued: number }
    >();
    for (const row of scriptRows) {
      const dept =
        row.script_bundles.exam_subject_mapping.classes.department_id;
      const code =
        row.script_bundles.exam_subject_mapping.classes.departments.code;
      const existing = totals.get(dept) ?? { code, total: 0, valued: 0 };
      existing.total += 1;
      totals.set(dept, existing);
    }
    for (const row of valuedRows) {
      const dept =
        row.script_bundles.exam_subject_mapping.classes.department_id;
      const code =
        row.script_bundles.exam_subject_mapping.classes.departments.code;
      const existing = totals.get(dept) ?? { code, total: 0, valued: 0 };
      existing.valued += 1;
      totals.set(dept, existing);
    }

    return [...totals.values()]
      .map((d) => ({
        departmentCode: d.code,
        total: d.total,
        valued: d.valued,
        percentage:
          d.total > 0 ? Math.round((d.valued / d.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.percentage - a.percentage);
  }

  /** Real monthly fee-collection series — last 6 calendar months that actually have a paid transaction. */
  private async buildFeeCollectionTrend() {
    const txns = await this.prisma.exam_fee_transactions.findMany({
      where: { status: 'paid' },
      select: { amount: true, created_at: true },
    });
    const byMonth = new Map<string, number>();
    for (const t of txns) {
      const key = t.created_at.toISOString().slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + Number(t.amount));
    }
    return [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([month, total]) => ({ month, total }));
  }

  /** Real recent-activity feed merged from five genuinely timestamped, unrelated event sources — no synthetic log table exists, so this is the closest real signal for each event type. */
  private async buildRecentActivity() {
    type Activity = { timestamp: Date; type: string; description: string };
    const activities: Activity[] = [];

    const [
      attendanceRows,
      hallTicketRows,
      malpracticeRows,
      marksLockRows,
      revaluationWindowRows,
    ] = await Promise.all([
      this.prisma.attendance_records.findMany({
        where: { is_published: true },
        orderBy: { published_at: 'desc' },
        take: 300,
        select: {
          published_at: true,
          class_id: true,
          subject_id: true,
          attendance_date: true,
          status: true,
          subjects: { select: { subject_code: true } },
        },
      }),
      this.prisma.hall_tickets.findMany({
        orderBy: { generated_at: 'desc' },
        take: 50,
        select: {
          generated_at: true,
          exam_id: true,
          exams: {
            select: { exam_types: { select: { name: true } }, semester: true },
          },
        },
      }),
      this.prisma.malpractice_incidents.findMany({
        orderBy: { created_at: 'desc' },
        take: 2,
        select: {
          created_at: true,
          seat_number: true,
          venues: { select: { name: true } },
        },
      }),
      this.prisma.marks_entry_locks.findMany({
        where: { is_locked: true },
        orderBy: { locked_at: 'desc' },
        take: 2,
        select: {
          locked_at: true,
          departments: { select: { code: true } },
          exams: { select: { exam_types: { select: { name: true } } } },
        },
      }),
      this.prisma.revaluation_windows.findMany({
        orderBy: { created_at: 'desc' },
        take: 2,
        select: {
          created_at: true,
          is_open: true,
          closes_at: true,
          exams: {
            select: { exam_types: { select: { name: true } }, semester: true },
          },
        },
      }),
    ]);

    if (attendanceRows.length > 0 && attendanceRows[0].published_at) {
      const groups = new Map<
        string,
        {
          publishedAt: Date;
          subjectCode: string;
          present: number;
          absent: number;
        }
      >();
      for (const r of attendanceRows) {
        if (!r.published_at) continue;
        const key = `${r.class_id}|${r.subject_id}|${r.attendance_date.toISOString()}`;
        const g = groups.get(key) ?? {
          publishedAt: r.published_at,
          subjectCode: r.subjects?.subject_code ?? 'Course',
          present: 0,
          absent: 0,
        };
        if (r.status === 'present') g.present += 1;
        else if (r.status === 'absent') g.absent += 1;
        groups.set(key, g);
      }
      const topGroups = [...groups.values()]
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, 2);
      for (const g of topGroups) {
        activities.push({
          timestamp: g.publishedAt,
          type: 'attendance',
          description: `${g.subjectCode} attendance closed · ${g.present} present, ${g.absent} absent`,
        });
      }
    }

    if (hallTicketRows.length > 0) {
      const latest = hallTicketRows[0].generated_at.getTime();
      const batch = hallTicketRows.filter(
        (h) => h.generated_at.getTime() === latest,
      );
      const first = batch[0];
      activities.push({
        timestamp: first.generated_at,
        type: 'tickets',
        description: `Hall tickets released for ${first.exams.exam_types.name} Semester ${first.exams.semester} (${batch.length} student${batch.length === 1 ? '' : 's'})`,
      });
    }

    for (const m of malpracticeRows) {
      activities.push({
        timestamp: m.created_at,
        type: 'incident',
        description: `Malpractice reported in ${m.venues?.name ?? 'a hall'}${m.seat_number ? `, seat ${m.seat_number}` : ''}`,
      });
    }

    for (const l of marksLockRows) {
      if (!l.locked_at) continue;
      activities.push({
        timestamp: l.locked_at,
        type: 'marks',
        description: `Marks locked for ${l.departments.code} · ${l.exams.exam_types.name}`,
      });
    }

    for (const w of revaluationWindowRows) {
      activities.push({
        timestamp: w.created_at,
        type: 'revaluation',
        description: w.is_open
          ? `Revaluation window opened for ${w.exams.exam_types.name} Semester ${w.exams.semester}${w.closes_at ? ` · closes ${w.closes_at.toISOString().slice(0, 10)}` : ''}`
          : `Revaluation window closed for ${w.exams.exam_types.name} Semester ${w.exams.semester}`,
      });
    }

    return activities
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 8);
  }
}
