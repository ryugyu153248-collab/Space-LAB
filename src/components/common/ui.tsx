import type { ReactNode } from 'react';

export const Field = ({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) => (
  <label className={`flex flex-col text-slate-400 text-[10px] uppercase tracking-wide ${className}`}>{label}<span className="mt-0.5 normal-case tracking-normal text-xs">{children}</span></label>
);
export const inputCls = 'bg-black/50 border border-edge rounded px-2 py-1 num text-slate-100 w-full';
export const Num = ({ value, onChange, step = 'any', min, max, className = '' }: { value: number | string; onChange: (v: number) => void; step?: string; min?: number; max?: number; className?: string }) => (
  <input type="number" className={`${inputCls} ${className}`} value={value} step={step} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} />
);
export const Sim = ({ children = 'SIMULATED' }: { children?: ReactNode }) => (
  <span className="px-1.5 py-[1px] rounded border text-[10px] uppercase tracking-wide bg-amber-900/40 text-amber-300 border-amber-700">{children}</span>
);
export const Busy = ({ text }: { text: string }) => <span className="text-accent animate-pulse">{text}</span>;
export const tone = (l: 'green' | 'yellow' | 'red') => ({ green: 'bg-emerald-900/50 text-emerald-300 border-emerald-700', yellow: 'bg-yellow-900/40 text-yellow-300 border-yellow-700', red: 'bg-red-900/50 text-red-300 border-red-700' }[l]);
export const Chip = ({ level, children }: { level: 'green' | 'yellow' | 'red'; children: ReactNode }) => <span className={`px-1.5 py-[1px] rounded border text-[10px] uppercase ${tone(level)}`}>{children}</span>;

/** Parse "YYYY-MM-DD HH:MM:SS" (UTC) or ISO text → epoch ms; NaN if invalid. */
export const parseUtc = (s: string): number => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.trim().replace(' ', 'T') + 'Z');
export const fmtUtcInput = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
