export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export const downloadText = (text: string, filename: string, mime = 'text/plain'): void => downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);

const esc = (v: string | number | undefined | null): string => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** RFC-4180 style CSV (numbers are written at full precision). */
export const toCsv = (rows: (string | number | undefined | null)[][]): string => rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';

export const safeName = (s: string): string => s.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);
