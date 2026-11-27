/** User-adjustable appearance of the 3-D globe (Layer manager → Style). */
export interface StyleSettings {
  orbitWidth: number;
  orbitOpacity: number;
  trackWidth: number;
  trackOpacity: number;
  trackColor: string;
  linkColor: string;
  footprintOpacity: number;
  heatmapOpacity: number;
  cloudOpacity: number;
  shadowOpacity: number;
  atmosphere: number;
  exaggeration: number;
}

export const DEFAULT_STYLE: StyleSettings = {
  orbitWidth: 2, orbitOpacity: 0.95, trackWidth: 2, trackOpacity: 0.9, trackColor: '#facc15', linkColor: '#22c55e',
  footprintOpacity: 0.28, heatmapOpacity: 0.65, cloudOpacity: 0.45, shadowOpacity: 0.28, atmosphere: 1, exaggeration: 1,
};
