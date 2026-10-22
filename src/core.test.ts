import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, Settings, avgWorkday, balanceBefore, balanceSeries, balanceTotal, breakFor, clockForNet, dayResult,
  fmtSigned, mondayOf, parseSigned, pay, spanTotals,
} from './core';

const s: Settings = { ...DEFAULT_SETTINGS };
const wed = '2026-10-21'; // Mittwoch
const fri = '2026-10-23';

describe('wie die alte App (Pause pauschal)', () => {
  it('07:18–15:30, ab 18, Soll 7:42 → +0:00', () => {
    const r = dayResult({ date: wed, kind: 'work', start: 438, end: 930 }, s);
    expect(r.gross).toBe(492);
    expect(r.brk).toBe(30);
    expect(r.net).toBe(462);
    expect(r.diff).toBe(0);
  });
  it('unter 18 zieht 60 Min. ab', () => {
    const r = dayResult({ date: wed, kind: 'work', start: 438, end: 930 }, { ...s, under18: true });
    expect(r.diff).toBe(-30);
  });
  it('0:00-Uhrzeit entspricht alter Formel Ende + Fehlzeit', () => {
    expect(clockForNet(438, 462, s)).toBe(930);
  });
  it('Stundenlohn wie bisher (Netto / Monatsstunden)', () => {
    const p = pay({ ...s, netSalary: 1000 });
    expect(p.monthlyHours).toBeCloseTo(166.83, 2);
    expect(p.hourly).toBeCloseTo(5.994, 3);
  });
});

describe('gesetzliche Staffelung', () => {
  const l: Settings = { ...s, breakMode: 'legal' };
  it('Erwachsene', () => {
    expect(breakFor(360, l)).toBe(0);
    expect(breakFor(361, l)).toBe(30);
    expect(breakFor(541, l)).toBe(45);
  });
  it('unter 18', () => {
    const u = { ...l, under18: true };
    expect(breakFor(270, u)).toBe(0);
    expect(breakFor(271, u)).toBe(30);
    expect(breakFor(361, u)).toBe(60);
  });
  it('Zielzeit berücksichtigt wachsende Pause', () => {
    // 9 h netto → 9:45 brutto
    expect(clockForNet(420, 540, l)).toBe(420 + 585);
  });
});

describe('Konto', () => {
  const entries = {
    '2026-10-19': { date: '2026-10-19', kind: 'work' as const, start: 420, end: 960 }, // 9:00 brutto → +0:48
    '2026-10-20': { date: '2026-10-20', kind: 'school' as const },
    [wed]: { date: wed, kind: 'work' as const, start: 420 }, // offen
  };
  it('summiert abgeschlossene Tage + Startsaldo', () => {
    expect(balanceBefore(entries, { ...s, startBalanceMin: 60 }, wed)).toBe(108);
  });
  it('zählt den laufenden Tag erst nach dem Ausstempeln', () => {
    expect(balanceTotal(entries, s, wed)).toBe(48);
    const closed = { ...entries, [wed]: { ...entries[wed], end: 420 + 522 } };
    expect(balanceTotal(closed, s, wed)).toBe(78);
  });
  it('Wochenende hat Soll 0', () => {
    expect(dayResult({ date: '2026-10-24', kind: 'work', start: 600, end: 690 }, s).diff).toBe(60);
  });
  it('Freitag-Ziel', () => {
    const prior = 120;
    const need = s.sollMin + (s.fridayThresholdMin - prior);
    expect(clockForNet(420, need, s)).toBe(420 + 462 + 60 + 30);
    expect(mondayOf(fri)).toBe('2026-10-19');
  });
});

describe('Ringe, Verlauf, Trends', () => {
  const entries = {
    '2026-10-19': { date: '2026-10-19', kind: 'work' as const, start: 420, end: 960 }, // netto 8:30, +0:48
    '2026-10-20': { date: '2026-10-20', kind: 'school' as const }, // 7:42 angerechnet
    [wed]: { date: wed, kind: 'work' as const, start: 420 }, // läuft
  };
  it('Wochensumme zählt den laufenden Tag live mit', () => {
    const w = spanTotals(entries, s, '2026-10-19', '2026-10-25', wed, 420 + 300);
    expect(w.soll).toBe(3 * 462);
    expect(w.net).toBe(510 + 462 + 270);
    expect(w.diff).toBe(48); // laufender Tag zählt noch nicht ins Plus/Minus
    expect(w.days).toBe(2);
  });
  it('Kontoverlauf pro Tag', () => {
    expect(balanceSeries(entries, s, wed, 3)).toEqual([48, 48, 48]);
  });
  it('Durchschnitt pro Arbeitstag ohne offene Tage', () => {
    expect(avgWorkday(entries, s, '2026-10-19', '2026-10-25')).toBe(510);
    expect(avgWorkday(entries, s, '2026-10-26', '2026-11-01')).toBeUndefined();
  });
});

describe('Eingaben', () => {
  it('parseSigned', () => {
    expect(parseSigned('+12:30')).toBe(750);
    expect(parseSigned('−0:45')).toBe(-45);
    expect(parseSigned('5')).toBe(300);
    expect(parseSigned('1:75')).toBeUndefined();
    expect(fmtSigned(-45)).toBe('−0:45');
  });
});
