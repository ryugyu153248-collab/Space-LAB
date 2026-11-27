import type { CesiumScene } from './CesiumScene';

/** Handle to the live 3D scene for non-React callers (capture, camera presets). */
export const sceneRegistry: { scene: CesiumScene | null } = { scene: null };
