import { type Address } from 'viem';

// ── Format address: 0x1234...abcd ────────────────────────
export function formatAddress(addr: Address | string): string {
  if (!addr || addr.length < 10) return addr || '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ── Format BOT balance: 1,234.56 ─────────────────────────
export function formatBOT(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const wholeStr = whole.toLocaleString('en-US');
  const fracStr = frac.toString().padStart(18, '0').slice(0, 2);
  return `${wholeStr}.${fracStr}`;
}

// ── Format BOT to compact: 1.2k, 3.4M ────────────────────
export function formatBOTCompact(wei: bigint): string {
  const bot = Number(wei) / 1e18;
  if (bot >= 1_000_000) return `${(bot / 1_000_000).toFixed(1)}M`;
  if (bot >= 1_000) return `${(bot / 1_000).toFixed(1)}k`;
  return bot.toFixed(2);
}

// ── Format timestamp to relative ──────────────────────────
export function timeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp * 1000;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}

// ── Format percentage ────────────────────────────────────
export function formatPct(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}
