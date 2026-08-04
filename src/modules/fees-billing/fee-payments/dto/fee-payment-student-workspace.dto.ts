export class StudentProfileSummaryDto {
  student_id: number;
  student_name: string | null;
  register_number: string | null;
  admission_no: string | null;
  student_id_no: string;
  programme: string;
  department: string;
  batch: string;
  gender: string | null;
  status: string;
}

export class FeeSummaryDto {
  total_demand: string;
  total_paid: string;
  total_outstanding: string;
  due_status: 'paid' | 'partial' | 'pending';
}

export class DemandSummaryItemDto {
  student_fee_demand_mapping_id: number;
  fee_structure_id: number;
  fee_structure_name: string;
  academic_year: string;
  semester: number | null;
  total_amount: string;
  paid_amount: string;
  outstanding_amount: string;
  due_status: 'paid' | 'partial' | 'pending';
}

export class PaymentSummaryDto {
  total_payments_count: number;
  total_amount_paid: string;
  last_payment_date: Date | null;
}

export class PaymentHistoryItemDto {
  id: number;
  student_fee_demand_mapping_id: number;
  amount_paid: string;
  payment_date: Date;
  payment_mode: string | null;
  receipt_no: string;
  is_partial: boolean;
  collected_by_user_id: number | null;
}

export class FeeConcessionItemDto {
  id: number;
  fee_structure_id: number;
  fee_structure_name: string;
  concession_amount: string;
  is_settled: boolean;
  settled_date: Date | null;
}

export class EducationLoanDdItemDto {
  id: number;
  student_fee_demand_mapping_id: number;
  dd_reference_number: string;
  bank_name: string;
  amount: string;
  status: string;
  acknowledgement_receipt_no: string | null;
  received_by_user_id: number | null;
}

export class FeePaymentStudentWorkspaceDto {
  student_profile: StudentProfileSummaryDto;
  fee_summary: FeeSummaryDto;
  demand_summary: DemandSummaryItemDto[];
  payment_summary: PaymentSummaryDto;
  payment_history: PaymentHistoryItemDto[];
  fee_concessions: FeeConcessionItemDto[];
  education_loan_dd: EducationLoanDdItemDto[];
}
