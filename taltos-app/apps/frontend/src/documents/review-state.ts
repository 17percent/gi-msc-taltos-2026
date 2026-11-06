import type { DocumentDetail } from '@taltos/shared';
import { CircleCheck, Hourglass, PencilLine, RotateCcw, type LucideIcon } from 'lucide-react';

export type ReviewState = DocumentDetail['reviewState'];

/** Spec 4.1 (D45): az állapot ikonnal és felirattal látszik, nem csak színnel. */
export const REVIEW_STATE: Record<
  ReviewState,
  { label: string; tone: 'neutral' | 'info' | 'success' | 'warning'; icon: LucideIcon }
> = {
  draft: { label: 'Piszkozat', tone: 'neutral', icon: PencilLine },
  pending: { label: 'Review-ra vár', tone: 'info', icon: Hourglass },
  approved: { label: 'Jóváhagyott', tone: 'success', icon: CircleCheck },
  changes_requested: { label: 'Átdolgozandó', tone: 'warning', icon: RotateCcw },
};
