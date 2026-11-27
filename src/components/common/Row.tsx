import type { ReactNode } from 'react';

export function Row({ label, value, unit, title }: { label: string; value: ReactNode; unit?: string; title?: string }) {
  return (
    <div className="flex justify-between gap-2 px-3 py-[2px]" title={title}>
      <span className="text-slate-400">{label}</span>
      <span className="num text-slate-100 text-right">
        {value}
        {unit && <span className="text-slate-500 ml-1">{unit}</span>}
      </span>
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone: 'real' | 'sim' | 'ok' | 'warn' | 'bad' }) {
  const c = {
    real: 'bg-emerald-900/50 text-emerald-300 border-emerald-700',
    sim: 'bg-amber-900/40 text-amber-300 border-amber-700',
    ok: 'bg-emerald-900/50 text-emerald-300 border-emerald-700',
    warn: 'bg-yellow-900/40 text-yellow-300 border-yellow-700',
    bad: 'bg-red-900/40 text-red-300 border-red-700',
  }[tone];
  return <span className={`px-1.5 py-[1px] rounded border text-[10px] uppercase tracking-wide ${c}`}>{children}</span>;
}
