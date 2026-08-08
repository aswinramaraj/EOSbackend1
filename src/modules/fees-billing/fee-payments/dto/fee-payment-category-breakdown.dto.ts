export class CategoryBreakdownItemDto {
  fee_structure_item_id: number;
  demand_category_name: string;
  original_amount: string;
  already_paid: string;
  outstanding_amount: string;
  status: 'paid' | 'partial' | 'pending';
}
