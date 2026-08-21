export class FeePaymentDashboardRowDto {
  student_fee_demand_mapping_id: number;
  student_id: number;
  student_name: string | null;
  register_number: string | null;
  programme: string;
  department: string;
  batch: string;
  // Real columns, previously unused by this DTO — added for the Billing
  // Portal's Students roster (needs quota + a real class_id for
  // announcement-audience targeting), purely additive, existing Admin
  // consumers of this endpoint simply ignore the new fields.
  quota: string;
  class_id: number | null;
  fee_structure_name: string;
  academic_year: string;
  total_demand: string;
  paid_amount: string;
  outstanding_amount: string;
  due_status: 'paid' | 'partial' | 'pending';
  last_payment_date: Date | null;
}
