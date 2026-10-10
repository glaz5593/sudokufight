/**
 * Stage 3, area "dev": the parts of the /dev/design-system screen (components.md §18) and the engine-made game
 * states they draw.
 */
export { BoardSection, KeypadSection } from './BoardSection';
export { ButtonSection, noop } from './ButtonSection';
export { CardSection } from './CardSection';
export { ColorSection } from './ColorSection';
export {
  boardScene,
  botScene,
  DS_AVATARS,
  DS_PLAYERS,
  DS_PROFILES,
  type DsProfile,
  FixtureGame,
  type FixtureOptions,
  fourPlayerScene,
  fourPlayerSurrenderScene,
  keypadScenes,
  type KeypadScenes,
  type MoveSnapshot,
  scoreChange,
  type Snapshot,
  surrenderRatingChange,
  threePlayerScene,
  twoPlayerOpening,
  twoPlayerScenes,
  type TwoPlayerScenes,
} from './fixtures';
export {
  contrastGrade,
  type ContrastGrade,
  formatRatio,
  PALETTES,
  type PaletteSpec,
  RADII,
  SWATCH_GROUPS,
  type SwatchGroup,
  type SwatchSpec,
  swatchRatio,
  TYPE_SCALE,
  type TypeSpec,
  typeSpecLine,
} from './foundations';
export { HudSection } from './HudSection';
export { AvatarSection } from './IdentitySection';
export { NavSection, OverlaySection, ToastSection } from './OverlaySection';
export {
  columnWidth,
  DsGroup,
  DsNote,
  DsSection,
  Specimen,
  SpecimenRow,
  useContentWidth,
} from './Primitives';
export { DS_SECTIONS, type DsSectionKey } from './sections';
export { TypeSection } from './TypeSection';
