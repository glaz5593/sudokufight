import type { ComponentType } from 'react';

import { BoardSection, KeypadSection } from './BoardSection';
import { ButtonSection } from './ButtonSection';
import { CardSection } from './CardSection';
import { ColorSection } from './ColorSection';
import { HudSection } from './HudSection';
import { AvatarSection } from './IdentitySection';
import { NavSection, OverlaySection, ToastSection } from './OverlaySection';
import { FieldSection, RowSection, StateSection } from './StateSection';
import { TypeSection } from './TypeSection';

/**
 * The parts of the design-system screen, in the order of the canvas boards: DS-Foundations (colour, type),
 * then DS-Components (components.md §18's checklist). Titles and notes are `sections.<key>.title|note` in the
 * "dev" namespace.
 */
export const DS_SECTIONS = [
  { key: 'colors', Component: ColorSection },
  { key: 'type', Component: TypeSection },
  { key: 'buttons', Component: ButtonSection },
  { key: 'identity', Component: AvatarSection },
  { key: 'cards', Component: CardSection },
  { key: 'hud', Component: HudSection },
  { key: 'board', Component: BoardSection },
  { key: 'keypad', Component: KeypadSection },
  { key: 'toasts', Component: ToastSection },
  { key: 'screenStates', Component: StateSection },
  { key: 'overlays', Component: OverlaySection },
  { key: 'rows', Component: RowSection },
  { key: 'nav', Component: NavSection },
  { key: 'fields', Component: FieldSection },
] as const satisfies readonly { key: string; Component: ComponentType }[];

export type DsSectionKey = (typeof DS_SECTIONS)[number]['key'];
