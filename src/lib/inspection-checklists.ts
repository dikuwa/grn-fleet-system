export type DefaultInspectionItem = { category: string; label: string; isCritical: boolean; requiresPhoto: boolean };

export const DEPARTURE_INSPECTION_ITEMS: DefaultInspectionItem[] = [
  { category: 'exterior', label: 'Body panels and paint condition', isCritical: false, requiresPhoto: true },
  { category: 'exterior', label: 'Windshield and windows (no cracks)', isCritical: true, requiresPhoto: false },
  { category: 'exterior', label: 'Mirrors (both sides, rearview)', isCritical: false, requiresPhoto: false },
  { category: 'tyres', label: 'Tyre tread depth and pressure', isCritical: true, requiresPhoto: true },
  { category: 'tyres', label: 'Spare tyre present and secure', isCritical: false, requiresPhoto: false },
  { category: 'lights', label: 'Headlights (high/low beam)', isCritical: true, requiresPhoto: false },
  { category: 'lights', label: 'Tail lights and brake lights', isCritical: true, requiresPhoto: false },
  { category: 'lights', label: 'Indicators and hazard lights', isCritical: true, requiresPhoto: false },
  { category: 'interior', label: 'Seat belts (all positions)', isCritical: true, requiresPhoto: false },
  { category: 'interior', label: 'Horn working', isCritical: false, requiresPhoto: false },
  { category: 'interior', label: 'Wipers and washer fluid', isCritical: false, requiresPhoto: false },
  { category: 'safety', label: 'Fire extinguisher present', isCritical: true, requiresPhoto: false },
  { category: 'safety', label: 'First aid kit present', isCritical: false, requiresPhoto: false },
  { category: 'safety', label: 'Warning triangle/reflectors', isCritical: false, requiresPhoto: false },
  { category: 'documents', label: 'Vehicle licence disc valid', isCritical: true, requiresPhoto: true },
  { category: 'documents', label: 'Roadworthy certificate valid', isCritical: true, requiresPhoto: false },
];

export const RETURN_INSPECTION_ITEMS: DefaultInspectionItem[] = [
  { category: 'exterior', label: 'Body panels and paint condition', isCritical: false, requiresPhoto: true },
  { category: 'exterior', label: 'Windshield and windows intact', isCritical: true, requiresPhoto: false },
  { category: 'tyres', label: 'Tyre condition (no damage)', isCritical: true, requiresPhoto: true },
  { category: 'lights', label: 'All lights functional', isCritical: false, requiresPhoto: false },
  { category: 'interior', label: 'Interior clean and undamaged', isCritical: false, requiresPhoto: true },
  { category: 'interior', label: 'Tool kit and jack present', isCritical: false, requiresPhoto: false },
  { category: 'safety', label: 'Fire extinguisher still present', isCritical: true, requiresPhoto: false },
  { category: 'safety', label: 'First aid kit present', isCritical: false, requiresPhoto: false },
  { category: 'fuel', label: 'Fuel level matches trip records', isCritical: false, requiresPhoto: false },
];
