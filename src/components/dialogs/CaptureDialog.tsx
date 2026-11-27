import { useRef, useState } from 'react';
import { useStore, type CameraMode } from '@/stores/store';
import { sceneRegistry } from '@/engine/cesium/registry';
import { clock } from '@/engine/simulation/runtime';
import { downloadBlob } from '@/engine/exporters/files';
import { formatUtc } from '@/engine/orbital/time';
import { Field, Num, inputCls } from '../common/ui';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MODES: CameraMode[] = ['earth', 'follow', 'orbit', 'groundstation', 'relative', 'dual', 'free'];

export function CaptureDialog() {
  const { dialog, setDialog, events, setCameraMode, cameraMode, setUiHidden } = useStore();
  const [scale, setScale] = useState(2);
  const [overlay, setOverlay] = useState(true);
  const [hideUi, setHideUi] = useState(true);
  const [mp4, setMp4] = useState(false);
  const [recording, setRecording] = useState(false);
  const [evId, setEvId] = useState('');
  const [pre, setPre] = useState(120);
  const [post, setPost] = useState(300);
  const [rate, setRate] = useState(10);
  const [cam, setCam] = useState<CameraMode>('follow');
  const [msg, setMsg] = useState('');
  const [prog, setProg] = useState<number | null>(null);
  const cancel = useRef(false);
  if (dialog !== 'capture') return null;
  const scene = () => { const s = sceneRegistry.scene; if (!s) throw new Error('3D scene not ready'); return s; };

  const shot = async () => {
    try {
      const before = useStore.getState().panels; void before;
      if (hideUi) { setUiHidden(true); await wait(450); }
      const blob = await scene().screenshot(scale, overlay);
      downloadBlob(blob, `space-lab_${stamp()}.png`);
      setMsg(`PNG saved (${scale}× resolution).`);
    } catch (e) { setMsg(String(e)); }
    setUiHidden(false);
  };
  const ext = (mime: string) => (mime.includes('mp4') ? 'mp4' : 'webm');
  const startVideo = () => { try { const r = scene().startRecording(overlay, mp4); setRecording(true); setMsg(`Recording (${r.mime})…`); } catch (e) { setMsg(String(e)); } };
  const stopVideo = async () => { const b = await scene().stopRecording(); setRecording(false); downloadBlob(b, `space-lab_${stamp()}.${ext(b.type)}`); setMsg(`Video saved (${b.type || 'webm'}, ${(b.size / 1e6).toFixed(1)} MB).`); };

  const recordEvent = async () => {
    const ev = events.find((e) => e.id === evId);
    if (!ev) return setMsg('Choose an event.');
    cancel.current = false;
    try {
      const sc = scene();
      const t0 = ev.start - pre * 1000, t1 = (ev.end ?? ev.start) + post * 1000;
      setCameraMode(cam); await wait(300);
      clock.pause(); clock.setReverse(false);
      const c = clock.snapshot();
      if (t0 < c.start || t1 > c.end) clock.setRange(Math.min(c.start, t0), Math.max(c.end, t1), t0); else clock.setTime(t0);
      clock.setRate(rate);
      sc.startRecording(overlay, mp4); setRecording(true); setUiHidden(hideUi);
      clock.play();
      while (clock.time < t1 && !cancel.current) { setProg((clock.time - t0) / (t1 - t0)); await wait(200); }
      clock.pause();
      const b = await sc.stopRecording();
      setRecording(false); setUiHidden(false); setProg(null);
      downloadBlob(b, `space-lab_${ev.name.replace(/\W+/g, '_')}_${stamp()}.${ext(b.type)}`);
      setMsg(`Event recording saved (${formatUtc(t0)} … ${formatUtc(t1)}, ${rate}×).`);
    } catch (e) { setMsg(String(e)); setRecording(false); setUiHidden(false); setProg(null); }
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => !recording && setDialog(null)}>
      <div className="w-[560px] max-w-[96vw] bg-panel border border-edge rounded-lg p-4 space-y-3 text-[11px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex"><span className="text-slate-100 font-semibold text-sm flex-1">Capture</span><button className="text-slate-500" onClick={() => setDialog(null)}>✕</button></div>
        <div className="flex gap-4 flex-wrap items-center">
          <label className="flex gap-1 items-center"><input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />Timestamp / event overlay</label>
          <label className="flex gap-1 items-center"><input type="checkbox" checked={hideUi} onChange={(e) => setHideUi(e.target.checked)} />Hide UI panels</label>
          <label className="flex gap-1 items-center"><input type="checkbox" checked={mp4} onChange={(e) => setMp4(e.target.checked)} />Prefer MP4 (browser support varies)</label>
        </div>
        <div className="border border-edge rounded p-2 space-y-2"><div className="text-slate-500 uppercase tracking-widest text-[10px]">Screenshot (PNG)</div>
          <div className="flex items-end gap-2"><Field label="Resolution"><select className={inputCls} value={scale} onChange={(e) => setScale(Number(e.target.value))}>{[1, 2, 3, 4].map((s) => <option key={s} value={s}>{s}× (current camera view)</option>)}</select></Field><button className="btn btn-on" onClick={shot}>Capture PNG</button></div></div>
        <div className="border border-edge rounded p-2 space-y-2"><div className="text-slate-500 uppercase tracking-widest text-[10px]">Video (MediaRecorder)</div>
          <div className="flex gap-2">{!recording ? <button className="btn btn-on" onClick={startVideo}>Start recording</button> : <button className="btn" onClick={stopVideo}>Stop &amp; save</button>}<span className="text-slate-500">Records the 3D view as it plays (WebM; MP4 only where the browser encodes it natively — no transcoding is bundled).</span></div></div>
        <div className="border border-edge rounded p-2 space-y-2"><div className="text-slate-500 uppercase tracking-widest text-[10px]">Automatic event recording</div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Event" className="col-span-3"><select className={inputCls} value={evId} onChange={(e) => setEvId(e.target.value)}><option value="">—</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name} · {formatUtc(e.start)}</option>)}</select></Field>
            <Field label="Before [s]"><Num value={pre} onChange={setPre} /></Field><Field label="After [s]"><Num value={post} onChange={setPost} /></Field><Field label="Speed [×]"><Num value={rate} onChange={setRate} /></Field>
            <Field label="Camera"><select className={inputCls} value={cam} onChange={(e) => setCam(e.target.value as CameraMode)}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></Field>
          </div>
          <div className="flex items-center gap-2"><button className="btn btn-on" disabled={recording} onClick={recordEvent}>Record event</button>{recording && <button className="btn" onClick={() => { cancel.current = true; }}>Finish now</button>}
            {prog !== null && <span className="num text-accent">{(prog * 100).toFixed(0)} %</span>}<span className="text-slate-500">Wall time ≈ {((pre + post) / rate).toFixed(0)} s. Keep this tab visible while recording. Current camera: {cameraMode}.</span></div></div>
        {msg && <div className="text-amber-300">{msg}</div>}
      </div>
    </div>
  );
}
