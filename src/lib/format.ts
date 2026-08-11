// ── Format address: 0x1234...abcd ────────────────────────
export function formatAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr || '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ── Format BOT balance: 1,234.56 ─────────────────────────
/**
 * Rounds rather than truncating, and widens past two decimals only when the
 * whole part is zero. Slicing the fraction printed 0.999999 as "0.99" and, more
 * awkwardly, made a genuinely cheap rate indistinguishable from an unpriced one.
 */
export function formatBOT(wei: bigint, maxFractionDigits = 2): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;

  const render = (digits: number) => {
    const scale = 10n ** BigInt(18 - digits);
    const rounded = (abs + scale / 2n) / scale;
    const unit = 10n ** BigInt(digits);
    return { whole: rounded / unit, frac: rounded % unit, digits };
  };

  // Decide the width from the ROUNDED value: 0.999999 is a two-decimal "1.00",
  // not a sub-unit amount. Widening is only for amounts that really are below
  // one, where a hard two decimals would print a cheap rate as "0.00" and make
  // it indistinguishable from an unpriced node.
  let result = render(maxFractionDigits);
  if (result.whole === 0n && abs > 0n) result = render(Math.max(maxFractionDigits, 4));

  const wholeStr = result.whole.toLocaleString('en-US');
  const fracStr = result.frac.toString().padStart(result.digits, '0');

  return `${negative ? '-' : ''}${wholeStr}.${fracStr}`;
}

// ── Format BOT to compact: 1.2k, 3.4M ────────────────────
export function formatBOTCompact(wei: bigint): string {
  const bot = Number(wei) / 1e18;
  if (bot >= 1_000_000) return `${(bot / 1_000_000).toFixed(1)}M`;
  if (bot >= 1_000) return `${(bot / 1_000).toFixed(1)}k`;
  return bot.toFixed(2);
}

// ── Format timestamp to relative ──────────────────────────
/** @param timestamp unix seconds @param nowMs injectable so this stays testable */
export function timeAgo(timestamp: number, nowMs: number = Date.now()): string {
  const diff = nowMs - timestamp * 1000;
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

// ── Format node id: #8532…1737 ───────────────────────────
// Node IDs are hash-derived and run to ~19 digits. Printed in full they
// dominate every card and can't be read at a glance anyway; the head and
// tail are enough to tell two nodes apart. Pair with a `title` attribute
// carrying the full value.
export function formatNodeId(id: bigint | string): string {
  const s = id.toString();
  if (s.length <= 10) return `#${s}`;
  return `#${s.slice(0, 4)}…${s.slice(-4)}`;
}
