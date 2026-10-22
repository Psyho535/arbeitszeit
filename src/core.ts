// Reine Rechenlogik ohne DOM – alle Zeiten in Minuten.

export type DayKind = 'work' | 'school' | 'vacation' | 'sick' | 'holiday';

export interface Entry {
  date: string; // YYYY-MM-DD (lokal)
  kind: DayKind;
  start?: number; // Minuten seit Mitternacht
  end?: number; // fehlt, solange eingestempelt
}

export interface Settings {
  under18: boolean;
  breakMode: 'fixed' | 'legal';
  sollMin: number; // Soll pro Arbeitstag (Mo–Fr)
  startBalanceMin: number; // Konto vor der ersten Erfassung
  netSalary: number;
  weeklyHours: number;
  fridayThresholdMin: number;
  forgotAfterMin: number; // Erinnerung „Ausstempeln vergessen?“ nach so viel Bruttozeit
  notify: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  under18: false,
  breakMode: 'fixed',
  sollMin: 7 * 60 + 42,
  startBalanceMin: 0,
  netSalary: 0,
  weeklyHours: 38.5,
  fridayThresholdMin: 180,
  forgotAfterMin: 10 * 60,
  notify: false,
};

export const KIND_LABEL: Record<DayKind, string> = {
  work: 'Arbeit',
  school: 'Berufsschule',
  vacation: 'Urlaub',
  sick: 'Krank',
  holiday: 'Feiertag',
};

/** Pause für eine Bruttozeit. „fixed“ entspricht der alten App (immer 30/60 Min.). */
export function breakFor(grossMin: number, s: Settings): number {
  if (s.breakMode === 'fixed') return s.under18 ? 60 : 30;
  if (s.under18) return grossMin > 360 ? 60 : grossMin > 270 ? 30 : 0; // JArbSchG §11
  return grossMin > 540 ? 45 : grossMin > 360 ? 30 : 0; // ArbZG §4
}

export function grossBetween(start: number, end: number): number {
  let g = end - start;
  if (g < 0) g += 1440; // über Mitternacht
  return g;
}

export function weekday(date: string): number {
  return parseDate(date).getDay(); // 0 = So
}

export function sollFor(date: string, s: Settings): number {
  const d = weekday(date);
  return d >= 1 && d <= 5 ? s.sollMin : 0;
}

export interface DayResult {
  gross: number;
  brk: number;
  net: number;
  soll: number;
  diff: number;
  open: boolean;
}

/** Ergebnis eines Tages; bei offenem Eintrag wird bis `nowMin` gerechnet. */
export function dayResult(e: Entry, s: Settings, nowMin?: number): DayResult {
  const soll = sollFor(e.date, s);
  if (e.kind !== 'work') return { gross: 0, brk: 0, net: soll, soll, diff: 0, open: false };
  if (e.start === undefined) return { gross: 0, brk: 0, net: 0, soll, diff: -soll, open: false };
  const open = e.end === undefined;
  const end = open ? nowMin ?? e.start : e.end!;
  const gross = grossBetween(e.start, end);
  const brk = gross > 0 ? Math.min(breakFor(gross, s), gross) : 0;
  const net = Math.max(gross - brk, 0);
  return { gross, brk, net, soll, diff: net - soll, open };
}

/** Bruttozeit, die nötig ist, um `targetNet` netto zu erreichen (Pause wächst ggf. mit). */
export function grossForNet(targetNet: number, s: Settings): number {
  let g = Math.max(targetNet, 0);
  for (let i = 0; i < 4; i++) g = Math.max(targetNet, 0) + breakFor(g, s);
  return g;
}

/** Uhrzeit (Minuten, evtl. > 1440), ab der netto `targetNet` erreicht ist. */
export function clockForNet(start: number, targetNet: number, s: Settings): number {
  return start + grossForNet(targetNet, s);
}

export function entriesSorted(entries: Record<string, Entry>): Entry[] {
  return Object.values(entries).sort((a, b) => a.date.localeCompare(b.date));
}

/** Kontostand: Startsaldo + Differenzen aller abgeschlossenen Tage vor `beforeDate` (exklusiv). */
export function balanceBefore(entries: Record<string, Entry>, s: Settings, beforeDate: string): number {
  let sum = s.startBalanceMin;
  for (const e of Object.values(entries)) {
    if (e.date >= beforeDate) continue;
    const r = dayResult(e, s);
    if (!r.open) sum += r.diff;
  }
  return sum;
}

/** Kontostand bis einschließlich `today`; ein laufender (offener) Tag zählt erst nach dem Ausstempeln. */
export function balanceTotal(entries: Record<string, Entry>, s: Settings, today: string): number {
  return balanceBefore(entries, s, addDays(today, 1));
}

export interface Span {
  net: number; // gearbeitete Nettozeit (Arbeitstage) bzw. angerechnetes Soll (Schule, Urlaub …)
  soll: number;
  diff: number; // nur abgeschlossene Tage
  days: number; // abgeschlossene erfasste Tage
}

/** Summen über einen Zeitraum [from, to] (inklusive); der heutige Tag zählt live mit. */
export function spanTotals(
  entries: Record<string, Entry>, s: Settings, from: string, to: string, today: string, nowMin: number,
): Span {
  const out: Span = { net: 0, soll: 0, diff: 0, days: 0 };
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const e = entries[d];
    const soll = sollFor(d, s);
    if (d <= today) out.soll += soll; // vergangene Tage ohne Eintrag zählen als Soll
    if (!e || d > today) continue;
    const r = dayResult(e, s, d === today ? nowMin : undefined);
    if (r.open && d !== today) continue;
    out.net += r.net;
    if (r.open) continue; // laufender Tag: Nettozeit live, Differenz erst nach dem Ausstempeln (wie das Konto)
    out.diff += r.diff;
    out.days++;
  }
  return out;
}

/** Kontostand am Ende jedes der letzten `n` Tage bis `today` (für den Verlauf). */
export function balanceSeries(entries: Record<string, Entry>, s: Settings, today: string, n: number): number[] {
  const from = addDays(today, -(n - 1));
  let bal = balanceBefore(entries, s, from);
  const out: number[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const e = entries[d];
    if (e) {
      const r = dayResult(e, s);
      if (!r.open) bal += r.diff;
    }
    out.push(bal);
  }
  return out;
}

/** Durchschnittliche Nettozeit pro erfasstem Arbeitstag im Zeitraum (nur abgeschlossene Arbeitstage). */
export function avgWorkday(entries: Record<string, Entry>, s: Settings, from: string, to: string): number | undefined {
  let sum = 0, n = 0;
  for (const e of Object.values(entries)) {
    if (e.date < from || e.date > to || e.kind !== 'work') continue;
    const r = dayResult(e, s);
    if (r.open || e.start === undefined) continue;
    sum += r.net;
    n++;
  }
  return n ? sum / n : undefined;
}

export interface Pay {
  monthlyHours: number;
  hourly: number;
}

export function pay(s: Settings): Pay {
  const monthlyHours = s.weeklyHours > 0 ? (s.weeklyHours * 52) / 12 : 0;
  return { monthlyHours, hourly: monthlyHours > 0 ? s.netSalary / monthlyHours : 0 };
}

// ---------- Datum ----------

export function toISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function mondayOf(iso: string): string {
  const wd = weekday(iso);
  return addDays(iso, wd === 0 ? -6 : 1 - wd);
}

export function weekDates(iso: string): string[] {
  const mo = mondayOf(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(mo, i));
}

export function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

// ---------- Format ----------

export function fmtDur(min: number): string {
  const a = Math.max(Math.round(min), 0);
  return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

export function fmtSigned(min: number): string {
  const r = Math.round(min);
  return `${r < 0 ? '−' : '+'}${fmtDur(Math.abs(r))}`;
}

export function fmtClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function parseClock(v: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return undefined;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : undefined;
}

/** „+12:30“, „-3:15“, „−0:45“ oder „5“ (Stunden) → Minuten. */
export function parseSigned(v: string): number | undefined {
  const t = v.trim().replace('−', '-');
  const m = /^([+-])?\s*(\d+)(?::(\d{1,2}))?$/.exec(t);
  if (!m || (m[3] !== undefined && +m[3] >= 60)) return undefined;
  const abs = +m[2] * 60 + (m[3] ? +m[3] : 0);
  return m[1] === '-' ? -abs : abs;
}

export function fmtEuro(v: number): string {
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
