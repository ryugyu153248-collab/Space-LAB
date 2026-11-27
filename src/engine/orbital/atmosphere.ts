/**
 * Exponential atmosphere, Vallado "Fundamentals of Astrodynamics" Table 8-4 (mean solar activity).
 *   ρ(h) = ρ0 exp(−(h − h0)/H)   within each altitude band.
 * Fidelity: LOW — static, no diurnal/solar-flux variation (not NRLMSISE/JB2008). Good to ~factor 2 at best.
 * Rows: [h0 km, ρ0 kg/m³, H km]
 */
const TABLE: [number, number, number][] = [
  [0, 1.225, 7.249], [25, 3.899e-2, 6.349], [30, 1.774e-2, 6.682], [40, 3.972e-3, 7.554], [50, 1.057e-3, 8.382],
  [60, 3.206e-4, 7.714], [70, 8.77e-5, 6.549], [80, 1.905e-5, 5.799], [90, 3.396e-6, 5.382], [100, 5.297e-7, 5.877],
  [110, 9.661e-8, 7.263], [120, 2.438e-8, 9.473], [130, 8.484e-9, 12.636], [140, 3.845e-9, 16.149], [150, 2.07e-9, 22.523],
  [180, 5.464e-10, 29.74], [200, 2.789e-10, 37.105], [250, 7.248e-11, 45.546], [300, 2.418e-11, 53.628],
  [350, 9.158e-12, 53.298], [400, 3.725e-12, 58.515], [450, 1.585e-12, 60.828], [500, 6.967e-13, 63.822],
  [600, 1.454e-13, 71.835], [700, 3.614e-14, 88.667], [800, 1.17e-14, 124.64], [900, 5.245e-15, 181.05],
  [1000, 3.019e-15, 268.0],
];

/** Density (kg/m³) at geometric altitude `h` metres above the reference sphere. */
export function density(h: number): number {
  const hk = Math.max(0, h / 1000);
  let row = TABLE[0];
  for (const r of TABLE) { if (hk >= r[0]) row = r; else break; }
  return row[1] * Math.exp(-(hk - row[0]) / row[2]);
}
