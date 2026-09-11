export class ExecutiveKpisDto {
  totalFeeDemand: string;
  totalCollected: string;
  totalOutstanding: string;
  collectionPercentage: number;
  pendingEducationLoanDD: number;
  activeFeeStructures: number;
  /**
   * Sum of fee_payments.amount_paid whose payment_date falls within the
   * caller's `from`/`to` query params — undefined when neither is passed
   * (every existing caller). totalCollected/collectionPercentage above stay
   * all-time on purpose: the Admin dashboard's period toggle (Today/This
   * term/This year) needs a genuinely windowed figure without disturbing
   * the cumulative "% of demand collected" metric Billing already relies on.
   */
  collectedInRange?: string;
  paymentCountInRange?: number;
}

export class DemandVsCollectionDto {
  totalDemand: string;
  totalCollected: string;
  totalOutstanding: string;
}

export class MonthlyCollectionTrendItemDto {
  month: string;
  totalCollected: string;
}

export class DepartmentOutstandingItemDto {
  department: string;
  totalDemand: string;
  totalOutstanding: string;
}

export class PaymentStatusDistributionItemDto {
  status: 'paid' | 'partial' | 'pending';
  count: number;
}

export class CollectionByPaymentModeItemDto {
  mode: string;
  totalAmount: string;
  count: number;
}

export class FinancialAnalyticsDto {
  demandVsCollection: DemandVsCollectionDto;
  monthlyCollectionTrend: MonthlyCollectionTrendItemDto[];
  departmentOutstanding: DepartmentOutstandingItemDto[];
  paymentStatusDistribution: PaymentStatusDistributionItemDto[];
  collectionByPaymentMode: CollectionByPaymentModeItemDto[];
}

export class RecentPaymentItemDto {
  id: number;
  student_id: number;
  student_name: string | null;
  amount_paid: string;
  payment_date: Date;
  payment_mode: string | null;
  receipt_no: string;
}

export class TopOutstandingStudentItemDto {
  student_id: number;
  student_name: string | null;
  register_number: string | null;
  total_outstanding: string;
}

export class ConcessionSummaryDto {
  total_concession_amount: string;
  count: number;
  settled_count: number;
  unsettled_count: number;
}

export class EducationLoanDdSummaryDto {
  total_amount: string;
  count: number;
  received_count: number;
  cleared_count: number;
  bounced_count: number;
}

export class OperationalInsightsDto {
  recentPayments: RecentPaymentItemDto[];
  topOutstandingStudents: TopOutstandingStudentItemDto[];
  concessionSummary: ConcessionSummaryDto;
  educationLoanDDSummary: EducationLoanDdSummaryDto;
}

export class FinanceOverviewResponseDto {
  executiveKPIs: ExecutiveKpisDto;
  financialAnalytics: FinancialAnalyticsDto;
  operationalInsights: OperationalInsightsDto;
}
