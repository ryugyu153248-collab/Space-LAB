/** Physical constants (SI). Sources noted per constant. */

/** Earth gravitational parameter GM, m^3/s^2 (EGM-96 / WGS84 value 3.986004418e14). */
export const MU_EARTH = 3.986004418e14;
/** WGS84 equatorial radius, m. */
export const R_EARTH = 6378137.0;
/** WGS84 flattening (dimensionless). */
export const F_EARTH = 1 / 298.257223563;
/** WGS84 first eccentricity squared: e^2 = f(2-f). */
export const E2_EARTH = F_EARTH * (2 - F_EARTH);
/** Earth rotation rate, rad/s (WGS84 / IERS nominal). */
export const OMEGA_EARTH = 7.292115e-5;
/** Earth J2 zonal harmonic (dimensionless). Used from Phase 3 (numerical propagator). */
export const J2_EARTH = 1.08262668e-3;
/** Standard gravity, m/s^2. */
export const G0 = 9.80665;

export const TWO_PI = 2 * Math.PI;
export const DEG = Math.PI / 180;
export const MS_PER_DAY = 86_400_000;
export const KM = 1000;
