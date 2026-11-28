import { useStore, type Layers } from '@/stores/store';
import { propagateSatellite } from '@/engine/orbital/propagate';
import { ecefToGeodetic, eciToEcef } from '@/engine/orbital/frames';
import { derivedElements, rvToElements } from '@/engine/orbital/elements';
import { norm } from '@/engine/orbital/vec';
import { tleStaleness } from '@/engine/data/tle';
import { AdvancedLeftPanel } from './LeftPanel';
import type { EarthLook } from '@/engine/cesium/style';

const LOOKS: [EarthLook, string, string][] = [['standard', 'ภาพถ่ายดาวเทียม', 'ภาพถ่ายจริง + เส้นแบ่งประเทศ'], ['schematic', 'แผนผัง', 'โลกสีฟ้าแบบแผนผัง'], ['cinematic', 'ภาพยนตร์', 'เมฆ ไฟเมือง แสงเรือง']];

/** The handful of switches most people need; everything else lives under “ตั้งค่าขั้นสูง”. */
const CHIPS: [keyof Layers, string, string][] = [
  ['borders', 'เส้นแบ่งประเทศ', 'เส้นขอบประเทศ (ไทยเน้นเป็นพิเศษ)'],
  ['orbits', 'วงโคจร', 'เส้นวงโคจรของดาวเทียม'],
  ['models', 'โมเดลดาวเทียม', 'แสดงโมเดล 3 มิติ'],
  ['labels', 'ชื่อ', 'ป้ายชื่อดาวเทียมและสถานี'],
  ['visibilityCones', 'วงครอบคลุมสถานี', 'พื้นที่ที่สถานีมองเห็นดาวเทียมได้'],
  ['commLinks', 'เส้นสัญญาณ', 'เส้นเชื่อมสถานี–ดาวเทียมเมื่ออยู่ในระยะ'],
  ['groundTracks', 'เส้นทางบนพื้นโลก', 'ground track'],
  ['graticule', 'เส้นกริด', 'เส้นละติจูด/ลองจิจูด'],
];

const Title = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => (
  <div className="flex items-center px-3 pt-4 pb-1.5 text-[11px] font-semibold text-slate-300">{children}<span className="flex-1" />{action}</div>
);

export function SimpleLeftPanel() {
  const { advancedPanel, setAdvancedPanel } = useStore();
  if (advancedPanel) return <AdvancedLeftPanel />;
  return <Simple onAdvanced={() => setAdvancedPanel(true)} />;
}

function Simple({ onAdvanced }: { onAdvanced: () => void }) {
  const { satellites, stations, selectedId, selectedStationId, select, selectStation, layers, toggleLayer, look, setLook, setDialog, removeSatellite, removeStation, updateStation, baseSatellites, scenarioName } = useStore();
  const clockTime = useStore((s) => s.clock.time);
  const sats = satellites.filter((s) => s.kind !== 'debris');
  const sel = sats.find((s) => s.id === selectedId);
  const st = sel ? propagateSatellite(sel, clockTime) : null;
  const info = st ? (() => { const g = ecefToGeodetic(eciToEcef(st.r, clockTime)); const d = derivedElements(rvToElements(st.r, st.v)); return { alt: g.alt / 1000, speed: norm(st.v) / 1000, period: d.period / 60 }; })() : null;
  const age = sel?.source.kind === 'tle' ? tleStaleness(sel.epoch, clockTime) : null;

  return (
    <div className="h-full bg-panel overflow-y-auto pb-6 text-[12px]">
      <div className="px-3 pt-3 text-[10px] text-slate-500 truncate" title={scenarioName}>{scenarioName}</div>

      <Title action={<button className="btn !py-0" title="เพิ่มดาวเทียม" onClick={() => setDialog('import')}>+ เพิ่ม</button>}>ดาวเทียม</Title>
      {sats.map((s) => {
        const active = s.id === selectedId;
        return (
          <div key={s.id} className="group">
            <div onClick={() => select(s.id)} className={`mx-2 rounded px-2 py-2 cursor-pointer flex items-center gap-2 ${active ? 'bg-slate-800 ring-1 ring-accent/60' : 'hover:bg-slate-800/50'}`}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="flex-1 truncate text-slate-100">{s.name}</span>
              <span className={`text-[10px] px-1.5 rounded ${s.origin === 'SIMULATED' ? 'text-amber-300 bg-amber-900/30' : 'text-emerald-300 bg-emerald-900/30'}`}>{s.origin === 'SIMULATED' ? 'จำลอง' : 'ข้อมูลจริง'}</span>
              {baseSatellites.some((b) => b.id === s.id) && <button className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100" title="ลบ" onClick={(e) => { e.stopPropagation(); removeSatellite(s.id); }}>✕</button>}
            </div>
            {active && info && (
              <div className="mx-2 mb-1 px-3 py-1.5 grid grid-cols-3 gap-1 text-center text-slate-400">
                <div><div className="num text-slate-100">{info.alt.toFixed(0)}</div>กม. สูง</div>
                <div><div className="num text-slate-100">{info.speed.toFixed(2)}</div>กม./วิ</div>
                <div><div className="num text-slate-100">{info.period.toFixed(0)}</div>นาที/รอบ</div>
              </div>
            )}
            {active && age && age.level !== 'fresh' && <div className="mx-3 mb-1 text-[11px] text-amber-300">⚠ ข้อมูลวงโคจรเก่า {Math.abs(age.days).toFixed(1)} วัน</div>}
          </div>
        );
      })}

      <Title action={<button className="btn !py-0" title="เพิ่มสถานี" onClick={() => setDialog('station')}>+ เพิ่ม</button>}>สถานีภาคพื้นดิน</Title>
      {stations.map((g) => {
        const active = g.id === selectedStationId;
        return (
          <div key={g.id} className="group">
            <div onClick={() => selectStation(g.id)} className={`mx-2 rounded px-2 py-2 cursor-pointer flex items-center gap-2 ${active ? 'bg-slate-800 ring-1 ring-accent/60' : 'hover:bg-slate-800/50'}`}>
              <span className="w-2.5 h-2.5 rotate-45 shrink-0" style={{ background: g.color }} />
              <span className="flex-1 truncate text-slate-100">{g.name}</span>
              <button className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100" title="ลบ" onClick={(e) => { e.stopPropagation(); removeStation(g.id); }}>✕</button>
            </div>
            {active && (
              <div className="mx-2 mb-1 px-3 py-1.5 text-slate-400 space-y-1">
                <div className="num">{(g.lat * 180 / Math.PI).toFixed(4)}° N · {(g.lon * 180 / Math.PI).toFixed(4)}° E</div>
                <label className="flex items-center gap-2">มุมเงยต่ำสุด
                  <input type="range" min={0} max={60} step={1} className="flex-1" value={Math.round(g.minElevation * 180 / Math.PI)} onChange={(e) => updateStation(g.id, { minElevation: Number(e.target.value) * Math.PI / 180 })} />
                  <span className="num w-8 text-right text-slate-100">{Math.round(g.minElevation * 180 / Math.PI)}°</span></label>
              </div>
            )}
          </div>
        );
      })}

      <Title>มุมมองโลก</Title>
      <div className="px-3 grid grid-cols-3 gap-1">
        {LOOKS.map(([k, label, hint]) => <button key={k} title={hint} className={`btn !py-1.5 ${look === k ? 'btn-on' : ''}`} onClick={() => setLook(k)}>{label}</button>)}
      </div>

      <Title>แสดงผล</Title>
      <div className="px-3 flex flex-wrap gap-1.5">
        {CHIPS.map(([k, label, hint]) => <button key={k} title={hint} onClick={() => toggleLayer(k)}
          className={`px-2 py-1 rounded-full border text-[11px] ${layers[k] ? 'border-accent text-accent bg-accent/10' : 'border-edge text-slate-500 hover:text-slate-300'}`}>{label}</button>)}
      </div>

      <div className="px-3 pt-5">
        <button className="btn w-full" onClick={onAdvanced}>⚙ ตั้งค่าขั้นสูง (Advanced)</button>
        <div className="pt-2 text-[10px] text-slate-600 leading-snug">เปิดแผงขวา “Info ◂” เพื่อดูข้อมูลละเอียดและเครื่องมือวิเคราะห์ · กด H เพื่อกลับหน้าแรก</div>
      </div>
    </div>
  );
}
