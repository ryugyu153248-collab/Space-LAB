import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '@/stores/store';
import { parseTleText } from '@/engine/data/tle';
import { clock } from '@/engine/simulation/runtime';
import { DEG, R_EARTH } from '@/engine/orbital/constants';

const ElSchema = z.object({
  name: z.string().min(1),
  altKm: z.number().min(100).max(40000),
  e: z.number().min(0).lt(0.95),
  i: z.number().min(0).max(180),
  raan: z.number().min(0).max(360),
  argp: z.number().min(0).max(360),
  nu: z.number().min(0).max(360),
});

export function ImportDialog() {
  const { dialog, setDialog, addTles, addSimulated } = useStore();
  const importOpen = dialog === 'import';
  const setImportOpen = (b: boolean) => setDialog(b ? 'import' : null);
  const [tab, setTab] = useState<'tle' | 'coe'>('tle');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [f, setF] = useState({ name: 'SIM-SAT', altKm: '700', e: '0', i: '98', raan: '0', argp: '0', nu: '0' });
  if (!importOpen) return null;

  const submitTle = () => {
    const r = parseTleText(text);
    setErrors(r.errors);
    if (r.tles.length) { addTles(r.tles); if (!r.errors.length) { setText(''); setImportOpen(false); } }
  };
  const submitCoe = () => {
    const p = ElSchema.safeParse({ name: f.name, altKm: +f.altKm, e: +f.e, i: +f.i, raan: +f.raan, argp: +f.argp, nu: +f.nu });
    if (!p.success) return setErrors(p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`));
    const v = p.data;
    // a is chosen so that the perigee altitude equals altKm:  a = (R + h_p)/(1 - e)
    const a = (R_EARTH + v.altKm * 1000) / (1 - v.e);
    addSimulated({ a, e: v.e, i: v.i * DEG, raan: v.raan * DEG, argp: v.argp * DEG, nu: v.nu * DEG }, v.name, clock.time);
    setErrors([]); setImportOpen(false);
  };
  const onFile = async (file?: File) => { if (file) setText(await file.text()); };

  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setImportOpen(false)}>
      <div className="w-[560px] max-w-[95vw] bg-panel border border-edge rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex border-b border-edge">
          {(['tle', 'coe'] as const).map((k) => (
            <button key={k} className={`px-4 py-2 ${tab === k ? 'text-accent border-b-2 border-accent' : 'text-slate-400'}`} onClick={() => { setTab(k); setErrors([]); }}>
              {k === 'tle' ? 'TLE (paste / file)' : 'Classical elements (simulated)'}
            </button>
          ))}
          <div className="flex-1" />
          <button className="px-3 text-slate-500" onClick={() => setImportOpen(false)}>✕</button>
        </div>
        <div className="p-4 space-y-2">
          {tab === 'tle' ? (
            <>
              <textarea className="w-full h-40 bg-black/50 border border-edge rounded p-2 num text-[11px]" spellCheck={false}
                placeholder={'ISS (ZARYA)\n1 25544U ...\n2 25544 ...'} value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex items-center gap-2">
                <input type="file" accept=".tle,.txt,.3le,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
                <div className="flex-1" />
                <button className="btn btn-on" onClick={submitTle}>Add satellites</button>
              </div>
              <p className="text-[10px] text-slate-500">2-line or 3-line (with name) format; checksum and catalog numbers are validated. Get current TLEs from CelesTrak / Space-Track and paste them here.</p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {([['name', 'Name'], ['altKm', 'Perigee altitude [km]'], ['e', 'Eccentricity e'], ['i', 'Inclination [°]'], ['raan', 'RAAN Ω [°]'], ['argp', 'Arg. perigee ω [°]'], ['nu', 'True anomaly ν [°]']] as const).map(([k, l]) => (
                  <label key={k} className="text-slate-400">{l}
                    <input className="w-full mt-0.5 bg-black/50 border border-edge rounded px-2 py-1 num text-slate-100" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
              <div className="flex"><div className="flex-1" /><button className="btn btn-on" onClick={submitCoe}>Add simulated satellite</button></div>
              <p className="text-[10px] text-slate-500">Epoch = current simulation time. Frame: ECI (TEME axes). Propagated with analytic two-body dynamics — labelled “Simulated”.</p>
            </>
          )}
          {errors.length > 0 && (
            <ul className="text-red-400 text-[11px] list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
        </div>
      </div>
    </div>
  );
}
