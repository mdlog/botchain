import { parseEther } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  formatAddress,
  formatBOT,
  formatBOTCompact,
  formatNodeId,
  formatPct,
  timeAgo,
} from './format';

describe('formatBOT', () => {
  it('rounds instead of truncating', () => {
    // Truncating printed this as 0.99, understating every balance by up to a cent.
    expect(formatBOT(parseEther('0.999999'))).toBe('1.00');
    expect(formatBOT(parseEther('1.005'))).toBe('1.01');
    expect(formatBOT(parseEther('1.004'))).toBe('1.00');
  });

  it('widens the fraction below 1 so a cheap rate is not shown as zero', () => {
    expect(formatBOT(parseEther('0.02'))).toBe('0.0200');
    expect(formatBOT(parseEther('0.0039'))).toBe('0.0039');
    expect(formatBOT(1n)).toBe('0.0000');
  });

  it('groups thousands and handles the zero and negative cases', () => {
    expect(formatBOT(parseEther('1234.5'))).toBe('1,234.50');
    expect(formatBOT(0n)).toBe('0.00');
    expect(formatBOT(-parseEther('1.5'))).toBe('-1.50');
  });

  it('carries a rounding overflow into the whole part', () => {
    expect(formatBOT(parseEther('9.999'))).toBe('10.00');
  });

  it('honours an explicit precision', () => {
    expect(formatBOT(parseEther('1.23456'), 4)).toBe('1.2346');
  });
});

describe('formatBOTCompact', () => {
  it('abbreviates large amounts', () => {
    expect(formatBOTCompact(parseEther('2500000'))).toBe('2.5M');
    expect(formatBOTCompact(parseEther('1500'))).toBe('1.5k');
    expect(formatBOTCompact(parseEther('12.34'))).toBe('12.34');
  });
});

describe('formatAddress', () => {
  it('keeps the head and tail', () => {
    expect(formatAddress('0x264F463571473F0b5C1e9E30018D8B23676b7B80')).toBe('0x264F...7B80');
  });

  it('passes through anything too short to abbreviate', () => {
    expect(formatAddress('0x1234')).toBe('0x1234');
    expect(formatAddress('')).toBe('');
  });
});

describe('formatNodeId', () => {
  it('abbreviates the 19-digit hash-derived ids', () => {
    expect(formatNodeId(8095440674693095102n)).toBe('#8095…5102');
  });

  it('prints short ids in full', () => {
    expect(formatNodeId(42n)).toBe('#42');
  });
});

describe('timeAgo', () => {
  const now = Math.floor(Date.parse('2026-08-11T12:00:00Z') / 1000);

  it('picks the coarsest unit that applies', () => {
    expect(timeAgo(now, now * 1000)).toBe('just now');
    expect(timeAgo(now - 120, now * 1000)).toBe('2m ago');
    expect(timeAgo(now - 7200, now * 1000)).toBe('2h ago');
    expect(timeAgo(now - 172800, now * 1000)).toBe('2d ago');
  });
});

describe('formatPct', () => {
  it('renders basis points as a percentage', () => {
    expect(formatPct(8500)).toBe('85.0%');
    expect(formatPct(0)).toBe('0.0%');
  });
});
