import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '@/stores/store';
import { DEG } from '@/engine/orbital/constants';

const Schema = z.object({
  name: z.string().trim().min(1, 'name required'),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  alt: z.number().min(-500).max(9000),
  minEl: z.number().min(0).max(89),
});

export function StationDialog() {
  const { dialog, setDialog, addStation } = useStore();
  const stationDialog = dialog === 'station';
  const setStationDialog = (b: boolean) => setDialog(b ? 'station' : null);
  const [f, setF] = useState({ name: 'New Station', lat: '0', lon: '0', alt: '0', minEl: '10' });
  const [errors, setErrors] = useState<string[]>([]);
  if (!stationDialog) return null;
  const submit = () => {
    const p = Schema.safeParse({ name: f.name, lat: +f.lat, lon: +f.lon, alt: +f.alt, minEl: +f.minEl });
    if (!p.success) return setErrors(p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    const v = p.data;
    addStation({ name: v.name, lat: v.lat * DEG, lon: v.lon * DEG, alt: v.alt, minElevation: v.minEl * DEG });
    setErrors([]); setStationDialog(false);
  };
  const fields = [['name', 'Name'], ['lat', 'Latitude [° N]'], ['lon', 'Longitude [° E]'], ['alt', 'Altitude [m, WGS84]'], ['minEl', 'Min elevation mask [°]']] as const;
  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setStationDialog(false)}>
      <div className="w-[420px] bg-panel border border-edge rounded-lg p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="text-slate-100 font-semibold">Add ground station</div>
        <div className="grid grid-cols-2 gap-2">
          {fields.map(([k, l]) => (
            <label key={k} className="text-slate-400">{l}
              <input className="w-full mt-0.5 bg-black/50 border border-edge rounded px-2 py-1 num text-slate-100" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        {errors.length > 0 && <ul className="text-red-400 text-[11px] list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        <div className="flex gap-2 justify-end"><button className="btn" onClick={() => setStationDialog(false)}>Cancel</button><button className="btn btn-on" onClick={submit}>Add</button></div>
      </div>
    </div>
  );
}
