/** Shared domain types. Units: SI (m, m/s, rad, kg) unless a name says otherwise. Time: UTC epoch milliseconds. */

export type Vec3 = [number, number, number];

/** Reference frames used in ORBITAL LAB. ECI == TEME axes in Phase 1 (see docs/ARCHITECTURE.md §5). */
export type Frame = 'TEME' | 'ECI' | 'ECEF';

export type PropagationModel = 'SGP4' | 'TWOBODY' | 'NUMERICAL';

/** Cartesian state. Position m, velocity m/s, in `frame`, at UTC epoch-ms `t`. */
export interface StateVector {
  t: number;
  r: Vec3;
  v: Vec3;
  frame: Frame;
  model: PropagationModel;
}

/** Classical orbital elements. Angles in radians, a in metres. */
export interface ClassicalElements {
  a: number;
  e: number;
  i: number;
  raan: number;
  argp: number;
  /** true anomaly */
  nu: number;
}

export interface Geodetic {
  /** rad, geodetic latitude on WGS84 */
  lat: number;
  /** rad, east-positive, (-pi, pi] */
  lon: number;
  /** m above the WGS84 ellipsoid */
  alt: number;
}

export type DataOrigin = 'REAL_TLE' | 'USER_TLE' | 'SIMULATED';

export interface TleSource {
  kind: 'tle';
  name: string;
  line1: string;
  line2: string;
}

export interface ElementsSource {
  kind: 'elements';
  elements: ClassicalElements;
  /** UTC epoch-ms at which `elements` are valid */
  epoch: number;
}

/** Cartesian initial state (inertial, TEME/ECI axes, SI). Used by deployed objects and debris. */
export interface StateSource {
  kind: 'state';
  epoch: number;
  r: Vec3;
  v: Vec3;
}

export type SatelliteSource = TleSource | ElementsSource | StateSource;

export type BurnDirection = 'prograde' | 'retrograde' | 'radial' | 'antiradial' | 'normal' | 'antinormal';

/** A planned burn. Impulsive: dv (m/s). Finite: thrust (N) over duration (s). Isp (s) drives mass flow in both. */
export interface Maneuver {
  id: string;
  name: string;
  kind: 'impulsive' | 'finite';
  /** UTC epoch-ms burn start */
  start: number;
  direction: BurnDirection;
  dv?: number;
  thrust?: number;
  duration?: number;
  isp: number;
}

export interface Dynamics {
  /** include J2 zonal gravity */
  j2: boolean;
  /** include atmospheric drag (Vallado exponential density) */
  drag: boolean;
}

export interface SpacecraftProps {
  /** total wet mass at the start of the numerical trajectory, kg */
  massKg: number;
  /** propellant part of massKg, kg */
  propellantKg: number;
  /** drag coefficient (dimensionless) and cross-section area (m^2) */
  cd: number;
  area: number;
  /** half-angle of the (conical) sensor, rad. undefined = no sensor */
  sensorHalfAngle?: number;
  /** solar array area (m^2), efficiency, battery capacity (Wh), bus load (W), comm load (W) */
  panelArea: number;
  panelEfficiency: number;
  batteryWh: number;
  busLoadW: number;
  commLoadW: number;
}

export type AttitudeMode = 'nadir' | 'sun' | 'target' | 'inertial';

/** From `start` the satellite slews (over slewSec) into `mode`. Quaternions are body→ECI. */
export interface AttitudeSegment {
  id: string;
  start: number;
  mode: AttitudeMode;
  slewSec: number;
  /** target geodetic (rad, m) for mode 'target' */
  target?: { lat: number; lon: number; alt: number };
}

export interface Satellite {
  id: string;
  name: string;
  noradId?: string;
  source: SatelliteSource;
  /** Where the data comes from – never mix real and simulated silently. */
  origin: DataOrigin;
  /** Human-readable provenance string shown in UI */
  provenance: string;
  /** UTC epoch-ms of the element set */
  epoch: number;
  color: string;
  /** 'sat' (default) or 'debris' (simplified fragment) */
  kind?: 'sat' | 'debris';
  props?: SpacecraftProps;
  dynamics?: Dynamics;
  maneuvers?: Maneuver[];
  attitude?: AttitudeSegment[];
  /** object ceases to exist at/after this time (collision, re-entry) */
  endTime?: number;
  /** id of the parent satellite for deployed objects / debris */
  parentId?: string;
}

export interface GroundStation {
  id: string;
  name: string;
  /** rad, WGS84 geodetic latitude */
  lat: number;
  /** rad, east-positive */
  lon: number;
  /** m above ellipsoid */
  alt: number;
  /** rad, elevation mask */
  minElevation: number;
  color: string;
}
