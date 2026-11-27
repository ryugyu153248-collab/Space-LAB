/**
 * Tiny procedural glTF-binary (GLB) builder: boxes, cylinders, cones and spheres merged per material.
 * Authoring frame = spacecraft BODY frame used everywhere else in the app:
 *   +Z = nadir / sensor side, +X = along-track side, +Y = solar-array axis (cross-track in nadir pointing).
 * glTF is Y-up/Z-forward and Cesium maps glTF (x,y,z) → Cesium model (Z, X, Y) = (gz, gx, gy), so a body point (bx,by,bz)
 * is emitted as glTF (by, bz, bx) — a cyclic permutation (right-handed, winding preserved). Entity orientation = body→ECEF.
 */
export type V3 = [number, number, number];
export interface Material { color: [number, number, number, number]; metallic?: number; roughness?: number; emissive?: [number, number, number] }

interface Mesh { pos: number[]; nrm: number[]; idx: number[] }

export class ModelBuilder {
  private meshes = new Map<string, { mat: Material; mesh: Mesh }>();
  /** radius of the bounding sphere (m), for camera framing */
  radius = 1;

  private mesh(key: string, mat: Material): Mesh {
    let m = this.meshes.get(key);
    if (!m) { m = { mat, mesh: { pos: [], nrm: [], idx: [] } }; this.meshes.set(key, m); }
    return m.mesh;
  }
  private track(p: V3) { this.radius = Math.max(this.radius, Math.hypot(...p)); }
  private vert(m: Mesh, p: V3, n: V3) { m.pos.push(p[1], p[2], p[0]); m.nrm.push(n[1], n[2], n[0]); this.track(p); return m.pos.length / 3 - 1; }

  /** Axis-aligned box centred at c with full size s. */
  box(key: string, mat: Material, c: V3, s: V3): this {
    const m = this.mesh(key, mat), h: V3 = [s[0] / 2, s[1] / 2, s[2] / 2];
    const faces: [V3, V3, V3][] = [ // normal, u, v
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    ];
    for (const [n, u, v] of faces) {
      const at = (a: number, b: number): V3 => [c[0] + h[0] * (n[0] + a * u[0] + b * v[0]), c[1] + h[1] * (n[1] + a * u[1] + b * v[1]), c[2] + h[2] * (n[2] + a * u[2] + b * v[2])];
      const i0 = this.vert(m, at(-1, -1), n), i1 = this.vert(m, at(1, -1), n), i2 = this.vert(m, at(1, 1), n), i3 = this.vert(m, at(-1, 1), n);
      m.idx.push(i0, i1, i2, i0, i2, i3);
    }
    return this;
  }

  /** Cylinder (or truncated cone) along `axis` (0=X,1=Y,2=Z), centred at c, length len, radii r0 (at −len/2) → r1 (at +len/2). */
  cylinder(key: string, mat: Material, c: V3, axis: 0 | 1 | 2, len: number, r0: number, r1 = r0, seg = 20): this {
    const m = this.mesh(key, mat);
    const a1 = ((axis + 1) % 3) as 0 | 1 | 2, a2 = ((axis + 2) % 3) as 0 | 1 | 2;
    const P = (t: number, ang: number, r: number): V3 => { const p: V3 = [c[0], c[1], c[2]]; p[axis] += t * len; p[a1] += r * Math.cos(ang); p[a2] += r * Math.sin(ang); return p; };
    const slope = (r0 - r1) / len;
    const side = (ang: number): V3 => { const n: V3 = [0, 0, 0]; n[axis] = slope; n[a1] = Math.cos(ang); n[a2] = Math.sin(ang); const l = Math.hypot(...n); return [n[0] / l, n[1] / l, n[2] / l]; };
    for (let i = 0; i < seg; i++) {
      const A = (i / seg) * 2 * Math.PI, B = ((i + 1) / seg) * 2 * Math.PI;
      const q0 = this.vert(m, P(-0.5, A, r0), side(A)), q1 = this.vert(m, P(-0.5, B, r0), side(B)), q2 = this.vert(m, P(0.5, B, r1), side(B)), q3 = this.vert(m, P(0.5, A, r1), side(A));
      m.idx.push(q0, q2, q1, q0, q3, q2);
    }
    for (const [t, r, sgn] of [[-0.5, r0, -1], [0.5, r1, 1]] as const) {
      if (r <= 0) continue;
      const n: V3 = [0, 0, 0]; n[axis] = sgn;
      const ctr = this.vert(m, P(t, 0, 0), n);
      const ring = Array.from({ length: seg }, (_, i) => this.vert(m, P(t, (i / seg) * 2 * Math.PI, r), n));
      for (let i = 0; i < seg; i++) { const a = ring[i], b = ring[(i + 1) % seg]; if (sgn > 0) m.idx.push(ctr, a, b); else m.idx.push(ctr, b, a); }
    }
    return this;
  }

  /** Shallow dish: a cone opening toward +axis direction `dir` (±1). */
  dish(key: string, mat: Material, c: V3, axis: 0 | 1 | 2, dir: 1 | -1, radius: number, depth: number): this {
    return this.cylinder(key, mat, c, axis, depth * dir, dir > 0 ? 0.05 : radius, dir > 0 ? radius : 0.05, 24);
  }

  /** Solar wing made of `n` panels laid out along ±Y from y0, each w (X) × l (Y), thickness t (Z), with cell-grid look via two materials. */
  wing(cell: Material, frame: Material, x: number, y0: number, dirY: 1 | -1, panels: number, w: number, l: number, t = 0.04, z = 0): this {
    for (let i = 0; i < panels; i++) {
      const yc = y0 + dirY * (l / 2 + i * (l + 0.08));
      this.box('cell', cell, [x, yc, z], [w, l * 0.94, t]);
      this.box('frame', frame, [x, yc, z - t * 0.4], [w * 1.02, l, t * 0.6]);
    }
    this.cylinder('frame', frame, [x, y0 + dirY * (panels * (l + 0.08)) / 2, z], 1, panels * (l + 0.08), 0.04, 0.04, 8);
    return this;
  }

  build(): ArrayBuffer {
    const entries = [...this.meshes.values()];
    const bins: ArrayBuffer[] = [], views: object[] = [], accessors: object[] = [], prims: object[] = [], materials: object[] = [];
    let off = 0;
    const push = (buf: ArrayBuffer, target: number) => {
      const pad = (4 - (buf.byteLength % 4)) % 4;
      const padded = new Uint8Array(buf.byteLength + pad); padded.set(new Uint8Array(buf));
      bins.push(padded.buffer); views.push({ buffer: 0, byteOffset: off, byteLength: buf.byteLength, target });
      off += padded.byteLength; return views.length - 1;
    };
    entries.forEach(({ mat, mesh }, i) => {
      const pos = new Float32Array(mesh.pos), nrm = new Float32Array(mesh.nrm), idx = new Uint32Array(mesh.idx);
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < pos.length; k += 3) for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], pos[k + j]); mx[j] = Math.max(mx[j], pos[k + j]); }
      const vp = push(pos.buffer, 34962), vn = push(nrm.buffer, 34962), vi = push(idx.buffer, 34963);
      accessors.push({ bufferView: vp, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: mn, max: mx });
      accessors.push({ bufferView: vn, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
      accessors.push({ bufferView: vi, componentType: 5125, count: idx.length, type: 'SCALAR' });
      prims.push({ attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 }, indices: accessors.length - 1, material: i });
      materials.push({ pbrMetallicRoughness: { baseColorFactor: mat.color, metallicFactor: mat.metallic ?? 0.3, roughnessFactor: mat.roughness ?? 0.6 }, emissiveFactor: mat.emissive ?? [0, 0, 0], doubleSided: true, alphaMode: mat.color[3] < 1 ? 'BLEND' : 'OPAQUE' });
    });
    const json = JSON.stringify({ asset: { version: '2.0', generator: 'space-lab procedural' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: prims }], materials, accessors, bufferViews: views, buffers: [{ byteLength: off }] });
    const jb = new TextEncoder().encode(json), jpad = (4 - (jb.length % 4)) % 4;
    const jchunk = new Uint8Array(jb.length + jpad).fill(0x20); jchunk.set(jb);
    const bin = new Uint8Array(off); let o = 0; for (const b of bins) { bin.set(new Uint8Array(b), o); o += b.byteLength; }
    const total = 12 + 8 + jchunk.length + 8 + bin.length;
    const out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jchunk.length, true); dv.setUint32(16, 0x4e4f534a, true); u8.set(jchunk, 20);
    const p2 = 20 + jchunk.length;
    dv.setUint32(p2, bin.length, true); dv.setUint32(p2 + 4, 0x004e4942, true); u8.set(bin, p2 + 8);
    return out;
  }
}
