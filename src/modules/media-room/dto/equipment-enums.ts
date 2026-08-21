export const EQUIPMENT_CATEGORIES = ['camera', 'lens', 'support', 'audio', 'lighting', 'aerial'] as const;

export enum EquipmentCondition {
  GOOD = 'good',
  FAIR = 'fair',
  NEEDS_REPAIR = 'needs_repair',
}

export enum EquipmentStatus {
  AVAILABLE = 'available',
  CHECKED_OUT = 'checked_out',
  IN_SERVICE = 'in_service',
  RETIRED = 'retired',
}
