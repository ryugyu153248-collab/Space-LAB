# SPACE LAB — Architecture & Design (Deliverable #27)

เอกสารนี้ครอบคลุม 10 หัวข้อที่ต้องส่งมอบก่อนเริ่ม Phase 1.
Units: SI ภายในระบบ (m, s, rad, kg) · Time: UTC (ภายในเก็บเป็น epoch ms / Julian Date) · Frames ระบุทุกครั้ง.

---

## 1. System Architecture

```
                   ┌───────────────────────── UI (React + Zustand) ─────────────────────────┐
                   │ Toolbar · Left(Explorer/Layers) · Right(Properties) · Bottom(Timeline) │
                   └───────────────▲──────────────────────────────────────┬─────────────────┘
                                   │ subscribe (selectors)                │ commands
                   ┌───────────────┴──────────────────────────────────────▼─────────────────┐
                   │                    Shared Simulation State (single source of truth)     │
                   │   SimulationClock  ·  ScenarioState (satellites, stations, events)      │
                   └───────▲───────────────────▲────────────────────▲────────────────────────┘
                           │ states(t)         │ events             │ read-only (t, states)
        ┌──────────────────┴───┐   ┌───────────┴──────────┐  ┌──────┴───────────────┐
        │ Orbital Mechanics    │   │ Event Management     │  │ Analysis Engine      │
        │ (pure TS, no DOM)    │   │ (Phase 3+)           │  │ (access, conj., cov.)│
        └──────────▲───────────┘   └──────────────────────┘  └──────────────────────┘
                   │ ephemeris samples
        ┌──────────┴────────────┐
        │ Visualization (Cesium)│  ← read-only consumer of states; never computes physics
        └───────────────────────┘
```

กฎเหล็ก: **Rendering ไม่คำนวณฟิสิกส์**. Cesium ได้รับตำแหน่งที่ Orbital Engine คำนวณแล้วเท่านั้น
(ผ่าน `SampledPositionProperty` ที่เติมจาก ephemeris เดียวกับที่ Dashboard/Analysis ใช้) ทำให้ผลลัพธ์ทุกจอสอดคล้องกัน.

| ระบบ | โมดูล | ขอบเขต |
|---|---|---|
| Visualization | `src/engine/cesium`, `renderer`, `camera`, `effects` | แสดงผลเท่านั้น |
| Orbital Mechanics | `src/engine/orbital/*` | ฟังก์ชันบริสุทธิ์ ทดสอบได้ ไม่ผูก DOM/Cesium |
| Simulation | `src/engine/simulation/*` | Clock, ScenarioManager, StateHistory |
| Events | `src/engine/events/*` | Registry + handlers (เริ่ม Phase 3) |
| Analysis | `src/engine/analysis/*` | Access/Conjunction/Coverage (Phase 2,4,5) |
| Data | `src/engine/data/*` | TLE parser, IndexedDB, import/export |

## 2. Technology Stack & เหตุผล

| เทคโนโลยี | เหตุผล |
|---|---|
| React 18 + TypeScript (strict) | Type safety สำหรับหน่วย/frames; ecosystem UI |
| Vite 5 | Build เร็ว, Worker/ESM รองรับดี, Vercel zero-config |
| Tailwind CSS 3 | Dark theme + ข้อมูลหนาแน่น เร็ว ไม่มี runtime CSS |
| Zustand | Store เล็ก, subscribe แบบ selector ไม่ re-render ทั้งแอป; อ่าน state นอก React ได้ (ใช้ใน render loop) |
| CesiumJS | WGS84, เวลา, terrain, glTF ตรงกับโจทย์ ไม่ต้องสร้าง globe เอง |
| satellite.js 7 | SGP4/SDP4 + TEME→ECF/geodetic มาตรฐาน |
| Recharts | กราฟ dashboard (Phase 1: Altitude/Speed vs Time) |
| Zod | Validate TLE/Scenario JSON ที่ import เข้ามา |
| Vitest | Unit tests (ใช้ Vite config เดิม) |
| IndexedDB (idb) / Web Workers | Phase 1 วางโครง; ใช้งานเต็มใน Phase 2+ |

**Imagery/Terrain โดยไม่ต้องมี API key:** ใช้ NaturalEarthII ที่มากับ CesiumJS (offline) เป็นค่าเริ่มต้น.
ถ้าผู้ใช้ตั้ง `VITE_CESIUM_ION_TOKEN` ใน env จะเปิด Cesium World Imagery/Terrain ให้อัตโนมัติ. ไม่มี key ใน source.

## 3. Folder Structure

ตามโจทย์ (`src/app, components, engine/{cesium,orbital,simulation,events,entities,analysis,mission,telemetry,data}, stores, types, utils, workers`)
โดย Phase 1 สร้างเฉพาะโฟลเดอร์ที่มีโค้ดจริง (ไม่สร้างไฟล์เปล่า/placeholder). โฟลเดอร์เฟสหลังเพิ่มเมื่อถึงเฟสนั้น.

```
src/
  app/            App.tsx, main entry
  components/     layout/ panels/ timeline/ charts/ common/
  engine/
    orbital/      constants, time, frames, elements, propagators/{sgp4,twobody}, ephemeris, sun, groundtrack
    simulation/   SimulationClock
    data/         tle (parse/validate/age), demo TLEs
    cesium/       CesiumScene (viewer, entities, layers)
  stores/         simStore, scenarioStore
  types/
  utils/
docs/ tests colocated as *.test.ts
```

## 4. Event System Design (implement Phase 3; Phase 1 reserves the types)

```ts
interface SimEvent {
  id: string; name: string; type: EventType;      // burn|eclipse|collision|deployment|docking|attitude|access|reentry|comm
  start: number; end?: number;                    // UTC epoch ms
  objects: string[]; params: Record<string, unknown>;
  status: 'scheduled'|'active'|'completed'|'failed';
  priority: number; dependsOn: string[];
  visual?: VisualEffectSpec; handlerId: string;   // handler resolved in EventRegistry
}
interface EventHandler { onStart(ctx); onTick?(ctx); onEnd(ctx); affectsOrbit: boolean }
```

- **EventRegistry**: type → handler (open/closed principle).
- **EventManager**: sorted by (start, priority); topological order สำหรับ dependsOn.
- Event ที่ `affectsOrbit` ทำให้ ephemeris ของวัตถุนั้น **invalidate ตั้งแต่ t_event** แล้ว recompute (ดูข้อ 5).
- Deterministic replay: จัด State Checkpoint ทุก N วินาที (StateHistory) → ย้อนเวลา = restore checkpoint ก่อนเวลาเป้าหมาย แล้ว propagate เดินหน้า; ไม่มี RNG ที่ไม่มี seed.

## 5. Orbital Mechanics Architecture

```
TLE ──► sgp4 propagator ──► TEME state (r,v) @ t   ──┐
Elements(COE) ──► coe→rv ─► ECI(J2000/TEME-approx)    ├─► Ephemeris(t) ──► frames ──► ECEF / geodetic
Maneuver@t_b ──► state@t_b ─► NEW numerical propagator (Phase 3) ┘
```

- `SatelliteSource = { kind:'tle', tle } | { kind:'elements', coe, epoch } | { kind:'numerical', initialState, epoch, forceModel }`
- **SGP4 state และ Numerical state แยก type กัน** (`PropagatedState` มี field `model: 'SGP4'|'TWOBODY'|'NUMERICAL'`). หลัง Maneuver ห้ามใช้ TLE ต่อ — สร้าง `numerical` source ใหม่จาก state ที่ t_burn.
- **Reference frames**: TLE→**TEME** (satellite.js). Elements/two-body → **ECI (inertial, axis = TEME ในเฟสนี้)**. การเทียบกับโลกหมุนใช้ GMST (IAU-82) → **ECEF** → WGS84 geodetic. UT1≈UTC (ผิดไม่เกิน 0.9 s → ≤~0.4 km บนพื้นผิว, ระบุเป็นข้อจำกัด).
- **Time**: ภายใน = UTC epoch ms; แปลงเป็น Julian Date (UTC) สำหรับ GMST. TT/TAI ไม่ใช้ใน Phase 1 (ระบุข้อจำกัด).
- **Ephemeris**: สุ่มตัวอย่างตำแหน่งในช่วงเวลา (step ปรับตามคาบ) แล้วส่งให้ทั้ง Cesium และ Charts → แหล่งเดียว.
- สมการทุกตัวมีคอมเมนต์: ตัวแปร / หน่วย / สมมติฐาน / ข้อจำกัด (ดู `elements.ts`, `twobody.ts`).
- Phase 3 เพิ่ม RK4/RK45 + J2 + drag; Phase ขั้นสูงเพิ่ม SRP.

## 6. Data Flow

1. ผู้ใช้วาง/นำเข้า TLE → `parseTleText` (Zod validate + checksum) → `Satellite` เก็บใน `scenarioStore` พร้อม `source`/`epoch`/staleness.
2. `SimulationClock` (เวลาจำลอง ≠ frame rate) ขับ `simStore.time` ที่ ~10 Hz สำหรับ UI; Cesium clock ซิงก์ผ่าน adapter เดียวกัน.
3. `Ephemeris` สร้างตัวอย่างล่วงหน้า (past/future window) → Cesium `SampledPositionProperty` + polylines + ground track.
4. Panel/Chart อ่าน `propagate(sat, simTime)` ที่ time เดียวกัน → ตัวเลขตรงกับภาพ.
5. (Phase 2+) Analysis รับ ephemeris/ state ชุดเดียวกัน.

## 7. Performance Strategy

- Simulation step แยกจาก render: clock ใช้ `performance.now()` + rate multiplier; UI store อัปเดตแบบ throttle.
- Ephemeris cache ต่อ satellite (key = satrec id + window + step); invalidate เมื่อ source เปลี่ยน.
- Cesium: `requestRenderMode` ไม่เปิดใน Phase 1 (มีการเคลื่อนที่ตลอด) แต่ใช้ SampledProperty + Lagrange interpolation แทนการอัปเดตทุกเฟรม; reuse entity ไม่สร้างใหม่ทุก tick.
- Code-splitting: Cesium เป็น chunk แยก, static assets copy ไป `public/cesium`.
- Worker: งานหนัก (conjunction screening, coverage grid) เข้า Web Worker ตั้งแต่ Phase 2/4 (โครง `src/workers` เพิ่มเมื่อมีงานจริง).

## 8. Development Roadmap

Phase 1 Core 3D & Orbit → 2 Ground Station & Access → 3 Maneuver → 4 SSA & Collision → 5 Advanced Events → 6 Recording & Report. **รอการอนุมัติระหว่างเฟส**.

## 9. Technical Risks

| ความเสี่ยง | ผลกระทบ | การรับมือ |
|---|---|---|
| Cesium ขนาดใหญ่ + static assets | build ช้า/ bundle ใหญ่ | chunk แยก, copy assets script, lazy load |
| ไม่มี Ion token → ไม่มี terrain/hi-res | ภาพโลกความละเอียดต่ำ | NaturalEarthII offline + env token (ระบุสถานะบน UI) |
| TLE ล้าสมัย | ตำแหน่งผิดหลายกม./วัน | แสดง epoch age + เตือน (>7 วัน เหลือง, >30 วัน แดง) |
| TLE ในโค้ดเป็นข้อมูลจริงที่เก่า | ไม่ใช่ข้อมูลล่าสุด | ป้ายกำกับ "Sample TLE (historic epoch)" ชัดเจน; ผู้ใช้วาง TLE ใหม่จาก CelesTrak เองได้ (CORS/ไม่มี key) |
| UT1-UTC / polar motion ไม่รวม | ผิด ≤ ~0.5 km ที่ ground | ระบุเป็นข้อจำกัด; แผนรวม EOP ภายหลัง |
| Sun/Moon accuracy | eclipse/ lighting | ใช้ Cesium ephemeris สำหรับภาพ; Analysis ใช้สมการ Meeus (ระบุความแม่นยำ) |
| Pc ต้องมี covariance | ปลอมผลได้ง่าย | บังคับตาม spec §9.2 (Phase 4) |
| Determinism ของ numerical integrator | replay ไม่ตรง | step คงที่/ seed คงที่, checkpoint |

## 10. Phase 1 Acceptance Criteria

1. โหลด TLE (วาง / ไฟล์ .tle .txt) แล้วดาวเทียมเคลื่อนที่ตามเวลาในโลก 3 มิติ
2. SGP4 ผ่านเทสต์กับ reference vector (Vallado/SGP4-VER ISS-like) ภายใน tolerance ที่ระบุ
3. Orbital elements (a,e,i,Ω,ω,ν, perigee/apogee alt, period, energy) แสดงและทดสอบ round-trip
4. Orbit past/future + ground track + sub-satellite point แสดงได้
5. Simulation Clock: play/pause/stop/reverse/reset/slider, 0.1×–10000×, UTC
6. Earth หมุนตามเวลาจำลอง (Cesium clock ถูกซิงก์), Sun lighting ตามเวลา
7. Dashboard: lat/lon/alt, r, v, speed, elements, source+epoch+staleness, กราฟ altitude/speed เชื่อมกับ clock
8. `npm test`, `npm run build` ผ่านโดยไม่มี error; Deploy ได้บน Vercel


---

## Addendum — as built (Phases 3–6)

- **Trajectories:** `engine/orbital/numerical.ts` (`Trajectory`: RK4, fixed 10 s coast / 2 s burn steps, nodes aligned to burn boundaries, cubic-Hermite lookup).
  `propagate.ts` is the single entry point: analytic/SGP4 before the first burn, numerical after; `state` sources (deployed objects, debris) are always numerical.
- **Events:** `engine/events/EventManager.ts` — scenario = pure function of (base satellites, events). Handlers per type; `affectsOrbit` events rebuild trajectories. Replay is deterministic (seeded PRNG, fixed steps, no wall-clock dependence).
- **Analysis:** `engine/analysis/*` (access, conjunction, collisionRisk, avoidance, eclipse, coverage (+ `workers/coverage.worker.ts`), rendezvous). All use `propagateSatellite`, the same states as the 3D view.
- **Persistence:** `engine/data/scenario.ts` (Zod + versioned migrations), `localStore.ts` (IndexedDB). No backend/database.
- **Deviation from the original plan:** positions are fed to Cesium per frame from the engine (not pre-sampled `SampledPositionProperty`), because maneuvers/events make trajectories mutable.
