import { useMemo, useState } from 'react';
import type { BurnDirection } from '@/types';
import { useStore } from '@/stores/store';
import { jumpTo } from '@/engine/simulation/runtime';
import { newEvent } from '@/engine/events/EventManager';
import type { Conjunction } from '@/engine/analysis/conjunction';
import { runConjunctions } from '@/engine/analysis/conjunctionRunner';
import { classifyRisk, collisionProbability } from '@/engine/analysis/collisionRisk';
import { evaluateAvoidance, minimumAvoidanceDv, type AvoidanceCandidate } from '@/engine/analysis/avoidance';
import { formatUtc } from '@/engine/orbital/time';
import { Busy, Chip, Field, Num, inputCls } from '../common/ui';

const DIRS: BurnDirection[] = ['prograde', 'retrograde', 'normal', 'antinormal', 'radial', 'antiradial'];
const later = () => new Promise((r) => setTimeout(r, 30)); // let the "calculating" state paint before the synchronous analysis

export function ConjunctionPanel() {
  const { satellites, selectedId, secondId, settings, setSettings, setConjunctionPair, addEvent, setBottomTab } = useStore();
  const clock = useStore((s) => s.clock);
  const [vsAll, setVsAll] = useState(false);
  const [screenKm, setScreenKm] = useState(10);
  const [results, setResults] = useState<Conjunction[]>([]);
  const [sel, setSel] = useState<number>(0);
  const [busy, setBusy] = useState('');
  const [lead, setLead] = useState(5677);
  const [dir, setDir] = useState<BurnDirection>('prograde');
  const [dv, setDv] = useState(0.5);
  const [target, setTarget] = useState(10);
  const [cand, setCand] = useState<AvoidanceCandidate | null>(null);
  const [note, setNote] = useState('');
  const a = satellites.find((s) => s.id === selectedId), b = satellites.find((s) => s.id === secondId);

  const cov = (c: Conjunction) => collisionProbability({
    conj: c, hbr: settings.hbr,
    covPrimary: settings.useCovariance ? { radial: settings.covPrimary, intrack: settings.covPrimary * 3, crosstrack: settings.covPrimary } : null,
    covSecondary: settings.useCovariance ? { radial: settings.covSecondary, intrack: settings.covSecondary * 3, crosstrack: settings.covSecondary } : null,
  });

  const analyze = async () => {
    if (!a) return;
    setBusy('Screening in a Web Worker…');
    const others = vsAll ? satellites.filter((s) => s.id !== a.id) : b ? [b] : [];
    const r = (await runConjunctions(a, others, clock.start, clock.end, screenKm * 1000).catch(() => [] as Conjunction[])).sort((x, y) => x.tca - y.tca);
    setResults(r); setSel(0); setCand(null); setBusy('');
    if (r[0]) setConjunctionPair([r[0].primaryId, r[0].secondaryId]);
  };
  const c = results[sel];
  const pc = useMemo(() => (c ? cov(c) : null), [c, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const risk = c && pc ? classifyRisk(c.miss, pc.pc) : null;
  const sec = c ? satellites.find((s) => s.id === c.secondaryId) : undefined;
  const prim = c ? satellites.find((s) => s.id === c.primaryId) : undefined;

  const preview = async () => { if (!c || !prim || !sec) return; setBusy('Evaluating avoidance…'); await later(); setCand(evaluateAvoidance(prim, sec, c.tca, lead, dir, dv)); setBusy(''); };
  const findMin = async () => {
    if (!c || !prim || !sec) return;
    setBusy('Searching minimum Δv…'); await later();
    const r = minimumAvoidanceDv(prim, sec, c.tca, lead, dir, target * 1000);
    setBusy('');
    if (!r) return setNote(`Even 20 m/s ${dir} does not reach ${target} km miss with this lead time.`);
    setNote(''); setDv(Math.ceil(r.dv * 1000) / 1000); setCand(r);
  };
  const apply = () => {
    if (!c || !cand) return;
    const e = newEvent('burn', cand.burn.start, [c.primaryId]);
    e.name = 'Collision Avoidance Maneuver'; e.params = { kind: 'impulsive', direction: dir, dv: Math.ceil(cand.dv * 1000) / 1000, isp: cand.burn.isp };
    addEvent(e); setBottomTab('maneuver');
  };
  const simulateCollision = () => {
    if (!c) return;
    const e = newEvent('collision', c.tca, [c.primaryId, c.secondaryId]); e.name = 'Simulated collision'; addEvent(e);
    jumpTo(c.tca + 30_000);
  };
  const afterPc = cand?.after ? cov(cand.after) : null;
  const afterRisk = cand?.after && afterPc ? classifyRisk(cand.after.miss, afterPc.pc) : null;

  return (
    <div className="flex h-full overflow-hidden text-[11px]">
      <div className="w-[44%] overflow-y-auto border-r border-edge">
        <div className="p-2 flex items-center gap-2 sticky top-0 bg-panel">
          <button className="btn btn-on" onClick={analyze} disabled={!a || (!b && !vsAll)}>Analyze conjunctions</button>
          <label className="flex items-center gap-1">screen &lt;<input type="number" className="bg-black/50 border border-edge rounded px-1 w-12 num" value={screenKm} min={1} onChange={(e) => setScreenKm(Number(e.target.value))} />km</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={vsAll} onChange={(e) => setVsAll(e.target.checked)} />vs all objects</label>
          {busy && <Busy text={busy} />}
          <span className="text-slate-500 truncate">{a?.name ?? '—'} ↔ {vsAll ? 'all' : b?.name ?? 'select a second satellite'}</span>
        </div>
        <table className="w-full num">
          <thead className="text-slate-500 text-left"><tr><th className="px-2">TCA (UTC)</th><th>Secondary</th><th>Miss [m]</th><th>V rel [m/s]</th><th>Risk</th></tr></thead>
          <tbody>
            {results.map((r, i) => { const rk = classifyRisk(r.miss, cov(r).pc); return (
              <tr key={i} className={`cursor-pointer hover:bg-slate-800/60 ${i === sel ? 'bg-slate-800/80' : ''}`} onClick={() => { setSel(i); setCand(null); jumpTo(r.tca - 120_000); setConjunctionPair([r.primaryId, r.secondaryId]); }}>
                <td className="px-2">{formatUtc(r.tca)}</td><td>{satellites.find((s) => s.id === r.secondaryId)?.name}</td><td>{r.miss.toFixed(0)}</td><td>{r.relSpeed.toFixed(0)}</td><td><Chip level={rk.level}>{rk.label}</Chip></td></tr>); })}
            {!results.length && <tr><td colSpan={5} className="px-2 py-2 text-slate-600">Run the analysis over the scenario window ({formatUtc(clock.start)} … {formatUtc(clock.end)}). Encounters closer than the screening distance are listed (same-altitude orbits meet near the plane intersections about twice per orbit).</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="w-[26%] min-w-[240px] overflow-y-auto border-r border-edge p-2 space-y-1">
        {c && pc && risk ? (<>
          <div className="flex items-center gap-2"><span className="text-slate-100 font-semibold">TCA {formatUtc(c.tca, true)}</span><Chip level={risk.level}>{risk.label}</Chip></div>
          <div className="num grid grid-cols-2 gap-x-3">
            <span className="text-slate-400">Miss distance</span><span>{c.miss.toFixed(1)} m</span>
            <span className="text-slate-400">Relative velocity</span><span>{c.relSpeed.toFixed(1)} m/s</span>
            <span className="text-slate-400">Radial</span><span>{c.ric.radial.toFixed(1)} m</span>
            <span className="text-slate-400">Along-track</span><span>{c.ric.intrack.toFixed(1)} m</span>
            <span className="text-slate-400">Cross-track</span><span>{c.ric.crosstrack.toFixed(1)} m</span>
            <span className="text-slate-400">Pc</span><span>{pc.pc === null ? 'not assessable' : pc.pc.toExponential(2)}</span>
          </div>
          <div className="text-slate-500">{pc.pc === null ? pc.note : pc.note + '.'} Risk basis: {risk.basis}.</div>
          <div className="text-slate-500">Relative position = secondary − primary, RIC of the primary. Geometry from the same propagated states as the 3D view.</div>
          <button className="btn" onClick={simulateCollision}>Simulate collision (simplified debris)</button>
        </>) : <div className="text-slate-600">Select an encounter.</div>}
        <div className="pt-2 text-slate-500 uppercase tracking-widest text-[10px]">Covariance (user-assumed)</div>
        <label className="flex items-center gap-1"><input type="checkbox" checked={settings.useCovariance} onChange={(e) => setSettings({ useCovariance: e.target.checked })} />Provide covariance to enable Pc</label>
        <div className="grid grid-cols-3 gap-1">
          <Field label="σ primary [m]"><Num value={settings.covPrimary} onChange={(v) => setSettings({ covPrimary: v })} /></Field>
          <Field label="σ secondary [m]"><Num value={settings.covSecondary} onChange={(v) => setSettings({ covSecondary: v })} /></Field>
          <Field label="HBR [m]"><Num value={settings.hbr} onChange={(v) => setSettings({ hbr: v })} /></Field>
        </div>
        <div className="text-slate-500">Diagonal RIC 1σ (in-track ×3). These are assumptions, not tracking data.</div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="text-slate-500 uppercase tracking-widest text-[10px]">Collision avoidance (primary maneuvers)</div>
        <div className="grid grid-cols-4 gap-1">
          <Field label="Lead [s]"><Num value={lead} onChange={setLead} /></Field>
          <Field label="Direction"><select className={inputCls} value={dir} onChange={(e) => setDir(e.target.value as never)}>{DIRS.map((d) => <option key={d}>{d}</option>)}</select></Field>
          <Field label="Δv [m/s]"><Num value={dv} onChange={setDv} /></Field>
          <Field label="Target miss [km]"><Num value={target} onChange={setTarget} /></Field>
        </div>
        <div className="flex gap-2"><button className="btn" onClick={preview} disabled={!c}>Preview</button><button className="btn" onClick={findMin} disabled={!c}>Find minimum Δv</button><button className="btn btn-on" onClick={apply} disabled={!cand}>Apply as burn event</button></div>
        {note && <div className="text-amber-300">{note}</div>}
        {c && cand?.after ? (
          <table className="w-full num mt-1"><thead className="text-slate-500 text-left"><tr><th></th><th>Before</th><th>After</th></tr></thead><tbody>
            <tr><td>Miss distance</td><td>{c.miss.toFixed(0)} m</td><td className="text-accent">{cand.after.miss.toFixed(0)} m</td></tr>
            <tr><td>TCA</td><td>{formatUtc(c.tca)}</td><td>{formatUtc(cand.after.tca)}</td></tr>
            <tr><td>Rel. speed</td><td>{c.relSpeed.toFixed(0)} m/s</td><td>{cand.after.relSpeed.toFixed(0)} m/s</td></tr>
            <tr><td>Pc</td><td>{pc?.pc === null || !pc ? 'n/a' : pc.pc.toExponential(1)}</td><td>{afterPc?.pc === null || !afterPc ? 'n/a' : afterPc.pc.toExponential(1)}</td></tr>
            <tr><td>Risk</td><td>{risk && <Chip level={risk.level}>{risk.label}</Chip>}</td><td>{afterRisk && <Chip level={afterRisk.level}>{afterRisk.label}</Chip>}</td></tr>
            <tr><td>Δv required</td><td>—</td><td>{cand.dv.toFixed(3)} m/s ({dir}, {(lead / 60).toFixed(0)} min before TCA)</td></tr>
          </tbody></table>
        ) : <div className="text-slate-600">Preview a burn on the primary to compare miss distance / risk before and after (numerically propagated).</div>}
        <div className="text-slate-500">Residual-risk statement is only as good as the covariance assumption. Collision debris uses a simplified model.</div>
      </div>
    </div>
  );
}
