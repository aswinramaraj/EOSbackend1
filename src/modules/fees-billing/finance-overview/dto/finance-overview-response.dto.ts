export class ExecutiveKpisDto {
  totalFeeDemand: string;
  totalCollected: string;
  totalOutstanding: string;
  collectionPercentage: number;
  pendingEducationLoanDD: number;
  activeFeeStructures: number;
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

export class FinancialAnalyticsDto {
  demandVsCollection: DemandVsCollectionDto;
  monthlyCollectionTrend: MonthlyCollectionTrendItemDto[];
  departmentOutstanding: DepartmentOutstandingItemDto[];
  paymentStatusDistribution: PaymentStatusDistributionItemDto[];
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
