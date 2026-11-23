/** A rate as "840 KB/s" or "12.4 MB/s" (decimal units, like Task Manager's network graph labels). */
export function formatRate(bytesPerSec: number) {
  if (bytesPerSec < 1000) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1_000_000) return `${Math.round(bytesPerSec / 1000)} KB/s`;
  const mb = bytesPerSec / 1_000_000;
  return `${mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB/s`;
}
