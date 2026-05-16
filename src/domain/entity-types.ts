export type EntityType =
  | 'person'
  | 'technology'
  | 'concept'
  | 'company'
  | 'product'
  | 'domain';

export interface ExtractedEntity {
  name: string;
  originalText: string;
  type: EntityType;
  confidence: number;
}

export interface ResolvedEntity {
  name: string;
  canonicalKey: string;
  type: EntityType;
  confidence: number;
  isNew: boolean;
}
