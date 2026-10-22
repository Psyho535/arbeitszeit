import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import {
  DayKind, DayResult, Entry, KIND_LABEL, Settings, addDays, avgWorkday, balanceBefore, balanceSeries, balanceTotal,
  clockForNet, dayResult, entriesSorted, fmtClock, fmtDur, fmtEuro, fmtSigned, minutesOf, mondayOf, parseClock, parseDate,
  parseSigned, pay, spanTotals, toISO, weekDates,
} from './core';
import { AppData, download, exportJSON, load, parseImport, save } from './store';
import { Reminder, icsFor, requestPermission, schedule } from './reminders';
import { closeSheet, openSheet, setupSheet } from './sheet';

registerSW({ immediate: true });

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let data: AppData;
let viewWeek = '';
let undo: { date: string; prev?: Entry } | null = null;

const fmtDay = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtSheet = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'short' });
const fmtMonth = new Intl.DateTimeFormat('de-DE', { month: 'long' });

function now() {
  const d = new Date();
  return { d, today: toISO(d), min: minutesOf(d) };
}

function s(): Settings {
  return data.settings;
}

function isoWeek(iso: string): number {
  const d = parseDate(iso);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

function dateAt(iso: string, min: number): Date {
  const d = parseDate(iso);
  d.setMinutes(min);
  return d;
}

// Erscheinungsbild: „auto“ folgt dem Gerät, sonst fest hell oder dunkel
const THEME_COLOR = { light: '#F2F2F6', dark: '#141517' };
function applyTheme() {
  const t = s().theme;
  const root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme;
  else root.dataset.theme = t;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const own = m.media.includes('dark') ? THEME_COLOR.dark : THEME_COLOR.light;
    m.content = t === 'auto' ? own : THEME_COLOR[t];
  });
  try {
    localStorage.setItem('theme', t); // für das Setzen vor dem ersten Zeichnen
  } catch {
    /* ohne Merken */
  }
}

function signClass(min: number) {
  return min > 0 ? 'pos' : min < 0 ? 'neg' : '';
}

// ---------- Stempeln ----------

async function persist() {
  await save(data);
}

async function punch() {
  const { today, min } = now();
  const prev = data.entries[today];
  undo = { date: today, prev: prev ? { ...prev } : undefined };
  if (!prev || prev.kind !== 'work' || prev.start === undefined) {
    data.entries[today] = { date: today, kind: 'work', start: min };
    toast(`Eingestempelt um ${fmtClock(min)}`, true);
  } else if (prev.end === undefined) {
    data.entries[today] = { ...prev, end: min };
    toast(`Ausgestempelt um ${fmtClock(min)}`, true);
  } else {
    // Nach dem Ausstempeln erneut: weiterarbeiten (Ende wieder öffnen)
    data.entries[today] = { ...prev, end: undefined };
    toast('Wieder eingestempelt, Ende entfernt', true);
  }
  await persist();
  stampMoment();
  try {
    navigator.vibrate?.(12); // kurzes Feedback (Android; iOS erlaubt das Web-Apps nicht)
  } catch {
    /* ohne Vibration */
  }
  render();
}

async function revert() {
  if (!undo) return;
  if (undo.prev) data.entries[undo.date] = undo.prev;
  else delete data.entries[undo.date];
  undo = null;
  await persist();
  hideToast();
  render();
}

function stampMoment() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = $('clock-digits');
  el.classList.remove('stamped');
  void el.offsetWidth;
  el.classList.add('stamped');
}

// ---------- Toast ----------

let toastTimer = 0;
function toast(msg: string, withUndo = false) {
  const t = $('toast');
  t.replaceChildren(document.createTextNode(msg));
  if (withUndo) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Rückgängig';
    b.addEventListener('click', revert);
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, withUndo ? 8000 : 5000);
}
function hideToast() {
  $('toast').hidden = true;
}

// ---------- Rendern ----------

function render() {
  const { d, today, min } = now();
  const st = s();
  const todayEntry = data.entries[today];
  const r = todayEntry ? dayResult(todayEntry, st, min) : undefined;
  const total = balanceTotal(data.entries, st, today);
  const prior = balanceBefore(data.entries, st, today);
  const working = !!todayEntry && todayEntry.kind === 'work' && todayEntry.start !== undefined && todayEntry.end === undefined;
  const done = !!todayEntry && todayEntry.kind === 'work' && todayEntry.end !== undefined;

  $('today-label').textContent = fmtDay.format(d);

  // Uhr in der Ringmitte
  const digits = $('clock-digits');
  const caption = $('ring-caption');
  const status = $('clock-status');
  const hint = $('clock-hint');
  const actions = $('clock-actions');
  actions.replaceChildren();
  hint.className = 'clock-hint';
  digits.classList.toggle('idle', !working && !done);

  const zeroAt = todayEntry?.start !== undefined ? clockForNet(todayEntry.start, r!.soll, st) : undefined;
  const fridayAt =
    todayEntry?.start !== undefined && parseDate(today).getDay() === 5
      ? clockForNet(todayEntry.start, r!.soll + Math.max(st.fridayThresholdMin - prior, 0), st)
      : undefined;

  if (working && r) {
    digits.textContent = fmtDur(r.net);
    caption.textContent = 'netto heute';
    status.textContent = `Seit ${fmtClock(todayEntry.start!)} eingestempelt`;
    if (r.diff < 0) hint.innerHTML = `Bei 0:00 um <strong>${fmtClock(zeroAt!)}</strong>, noch ${fmtDur(-r.diff)} Std.`;
    else {
      hint.innerHTML = `Soll erreicht, heute <strong>${fmtSigned(r.diff)}</strong>`;
      hint.classList.add('pos');
    }
    actions.append(actionBtn('Feierabend-Wecker in Kalender', () => addIcs(today, zeroAt!, fridayAt)));
  } else if (done && r) {
    digits.textContent = fmtDur(r.net);
    caption.textContent = 'netto heute';
    status.textContent = `${fmtClock(todayEntry.start!)} bis ${fmtClock(todayEntry.end!)}, Pause ${fmtDur(r.brk)}`;
    hint.innerHTML = `Tagesergebnis <strong>${fmtSigned(r.diff)}</strong>`;
    hint.classList.add(signClass(r.diff));
  } else if (todayEntry && todayEntry.kind !== 'work') {
    digits.textContent = fmtClock(min);
    caption.textContent = 'Uhrzeit';
    status.textContent = `Heute eingetragen: ${KIND_LABEL[todayEntry.kind]}`;
    hint.textContent = 'Zählt als Soll, das Konto bleibt gleich.';
  } else {
    digits.textContent = fmtClock(min);
    caption.textContent = 'Uhrzeit';
    status.textContent = r && r.soll === 0 ? 'Wochenende, jede Minute zählt als Plus' : 'Noch nicht eingestempelt';
    hint.textContent = '';
  }
  renderRings(today, min, todayEntry, r);

  // Stempel-Knopf
  $('stamp-label').textContent = working ? 'Ausstempeln' : done ? 'Weiterarbeiten' : 'Einstempeln';
  $('stamp-time').textContent = fmtClock(min);
  $('stamp').classList.toggle('out', working);

  renderBanner(today);
  renderWeek(today, min);
  renderCards(today, min, total, r, fridayAt);
  planReminders(today, todayEntry, working, zeroAt, fridayAt);
}

function actionBtn(label: string, fn: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pill';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

// ---------- Ringe ----------

function setRing(name: 'day' | 'week', p: number) {
  const arc = $(`arc-${name}`) as unknown as SVGCircleElement;
  const lap = $(`lap-${name}`) as unknown as SVGCircleElement;
  const first = Math.min(Math.max(p, 0), 1) * 100;
  const second = Math.min(Math.max(p - 1, 0), 1) * 100; // zweite Runde über dem Ziel
  arc.style.strokeDashoffset = String(100 - first);
  arc.classList.toggle('empty', first === 0);
  lap.style.strokeDashoffset = String(100 - second);
  lap.classList.toggle('empty', second === 0);
}

function renderRings(today: string, nowMin: number, e: Entry | undefined, r: DayResult | undefined) {
  const st = s();
  const dayGoal = st.sollMin;
  const dayNet = e && r ? r.net : 0; // Schule/Urlaub zählen als erfülltes Soll
  const mo = mondayOf(today);
  const week = spanTotals(data.entries, st, mo, addDays(mo, 6), today, nowMin);
  const weekGoal = st.sollMin * 5;
  setRing('day', dayGoal ? dayNet / dayGoal : 0);
  setRing('week', weekGoal ? week.net / weekGoal : 0);
  $('lg-day').innerHTML = `${fmtDur(dayNet)}<small> / ${fmtDur(dayGoal)} Std.</small>`;
  $('lg-week').innerHTML = `${fmtDur(week.net)}<small> / ${fmtDur(weekGoal)} Std.</small>`;
  $('rings').setAttribute(
    'aria-label',
    `${$('clock-digits').textContent} ${$('ring-caption').textContent}. Tag: ${fmtDur(dayNet)} von ${fmtDur(dayGoal)} Stunden. ` +
      `Woche: ${fmtDur(week.net)} von ${fmtDur(weekGoal)} Stunden.`,
  );
}

function renderBanner(today: string) {
  const banner = $('banner');
  const forgotten = entriesSorted(data.entries).filter(
    (e) => e.date < today && e.kind === 'work' && e.start !== undefined && e.end === undefined,
  );
  if (!forgotten.length) {
    banner.hidden = true;
    return;
  }
  const e = forgotten[forgotten.length - 1];
  banner.hidden = false;
  banner.replaceChildren(
    document.createTextNode(`Am ${fmtShort.format(parseDate(e.date))} fehlt die Ausstempelzeit. Der Tag zählt erst danach.`),
    actionBtn('Ausstempelzeit eintragen', () => openDay(e.date)),
  );
}

function renderWeek(today: string, nowMin: number) {
  const st = s();
  const dates = weekDates(viewWeek);
  const kw = isoWeek(viewWeek);
  $('week-title').textContent = mondayOf(today) === viewWeek ? `Diese Woche (KW ${kw})` : `KW ${kw}`;
  const rows = $('week-rows');
  rows.replaceChildren();
  openRow = null;
  let sum = 0;
  const first = entriesSorted(data.entries)[0]?.date ?? today; // vor der ersten Erfassung nichts anmahnen
  for (const date of dates) {
    const e = data.entries[date];
    const wd = parseDate(date).getDay();
    if ((wd === 0 || wd === 6) && !e) continue; // leeres Wochenende ausblenden
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'day-row';
    if (date === today) b.classList.add('today');
    if (date > today) b.classList.add('future');
    let what = '';
    let diffTxt = '';
    let cls = '';
    if (e) {
      const r = dayResult(e, st, date === today ? nowMin : undefined);
      if (e.kind !== 'work') what = KIND_LABEL[e.kind];
      else if (e.start !== undefined) what = `${fmtClock(e.start)} – ${e.end !== undefined ? fmtClock(e.end) : date === today ? 'läuft' : '?'}`;
      if (!r.open) {
        diffTxt = fmtSigned(r.diff);
        cls = signClass(r.diff);
        sum += r.diff;
      } else if (date === today) {
        diffTxt = fmtSigned(r.diff);
        cls = 'live';
      } else diffTxt = 'offen';
    } else {
      const missing = date < today && date > first;
      what = date === today ? 'noch nichts' : missing ? 'nicht erfasst' : '';
      diffTxt = missing ? 'nachtragen' : '';
    }
    b.innerHTML = `<span class="d">${fmtShort.format(parseDate(date))}</span><span class="w">${what}</span><span class="v ${cls}">${diffTxt}</span>`;
    b.setAttribute('aria-label', `${fmtDay.format(parseDate(date))}: ${what || 'leer'} ${diffTxt}. Bearbeiten`);
    b.addEventListener('click', () => {
      if (b.dataset.swiped) return; // nach dem Wischen kein Öffnen
      openDay(date);
    });
    if (e) {
      // Wischen nach links zeigt „Löschen“ (Tastatur: Löschen im Blatt)
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'swipe-del';
      del.textContent = 'Löschen';
      del.tabIndex = -1;
      del.setAttribute('aria-hidden', 'true');
      del.addEventListener('click', () => deleteEntry(date));
      li.append(del);
      enableSwipe(b);
    }
    li.append(b);
    rows.append(li);
  }
  const ws = $('week-sum');
  ws.textContent = fmtSigned(sum);
  ws.className = signClass(sum);

  // Monatsübersicht für den Monat des angezeigten Montags … bzw. heute
  const ref = mondayOf(today) === viewWeek ? today : viewWeek;
  const prefix = ref.slice(0, 7);
  let days = 0, net = 0, diff = 0;
  for (const e of Object.values(data.entries)) {
    if (!e.date.startsWith(prefix) || e.date > today) continue;
    const r = dayResult(e, st, e.date === today ? nowMin : undefined);
    if (r.open) continue;
    days++;
    net += e.kind === 'work' ? r.net : 0;
    diff += r.diff;
  }
  $('month-sum').textContent = days
    ? `${fmtMonth.format(parseDate(ref))}: ${days} ${days === 1 ? 'Tag' : 'Tage'} erfasst, ${fmtDur(net)} Std. gearbeitet, ${fmtSigned(diff)}`
    : `${fmtMonth.format(parseDate(ref))}: noch keine Tage erfasst`;

  renderChart(dates, today, nowMin);
}

// ---------- Wochen-Diagramm ----------

const DAY_LETTER = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function renderChart(dates: string[], today: string, nowMin: number) {
  const st = s();
  const shown = dates.filter((d) => {
    const wd = parseDate(d).getDay();
    return (wd >= 1 && wd <= 5) || data.entries[d];
  });
  const vals = shown.map((d) => {
    const e = data.entries[d];
    if (!e || d > today) return { d, net: 0, cls: '' };
    const r = dayResult(e, st, d === today ? nowMin : undefined);
    if (r.open && d !== today) return { d, net: 0, cls: '' };
    return { d, net: r.net, cls: r.open ? 'live' : r.diff < 0 ? 'short' : '' };
  });
  const W = 320, top = 18, bottom = 24, H = 150 - top - bottom;
  const max = Math.max(st.sollMin * 1.25, ...vals.map((v) => v.net * 1.1), 60);
  const y = (m: number) => top + H - (m / max) * H;
  const slot = W / shown.length;
  const bw = Math.min(28, slot * 0.5);
  let svg = '';
  vals.forEach((v, i) => {
    const cx = slot * i + slot / 2;
    const h = Math.max((v.net / max) * H, v.net > 0 ? 4 : 0);
    if (h > 0) {
      svg += `<rect class="bar ${v.cls}" x="${(cx - bw / 2).toFixed(1)}" y="${(top + H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="5"/>`;
      svg += `<text class="val" x="${cx.toFixed(1)}" y="${(top + H - h - 5).toFixed(1)}" text-anchor="middle">${fmtDur(v.net)}</text>`;
    }
    svg += `<text class="day-label ${v.d === today ? 'today' : ''}" x="${cx.toFixed(1)}" y="${150 - 6}" text-anchor="middle">${DAY_LETTER[parseDate(v.d).getDay()]}</text>`;
  });
  const ys = y(st.sollMin).toFixed(1);
  svg = `<line class="soll" x1="0" x2="${W}" y1="${ys}" y2="${ys}"/><text class="soll-label" x="${W}" y="${(+ys - 5).toFixed(1)}" text-anchor="end">Soll ${fmtDur(st.sollMin)}</text>` + svg;
  const chart = $('week-chart');
  chart.innerHTML = svg;
  chart.setAttribute(
    'aria-label',
    'Arbeitszeit pro Tag: ' + vals.map((v) => `${DAY_LETTER[parseDate(v.d).getDay()]} ${fmtDur(v.net)}`).join(', '),
  );
}

// ---------- Übersichtskarten ----------

function renderCards(today: string, nowMin: number, total: number, r: DayResult | undefined, fridayAt?: number) {
  const st = s();
  const unit = (v: string, u: string) => `${v}<small>${u}</small>`;

  // Zeitkonto mit Verlauf der letzten 14 Tage
  $('konto-value').innerHTML = unit(fmtSigned(total), 'Std.');
  const series = balanceSeries(data.entries, st, today, 14);
  const lo = Math.min(0, ...series), hi = Math.max(0, ...series);
  const span = hi - lo || 60;
  const py = (v: number) => 36 - ((v - lo) / span) * 32;
  const pts = series.map((v, i) => `${((i / (series.length - 1)) * 140).toFixed(1)},${py(v).toFixed(1)}`);
  $('konto-spark').innerHTML =
    `<line class="zero" x1="0" x2="140" y1="${py(0).toFixed(1)}" y2="${py(0).toFixed(1)}"/>` +
    `<polygon class="area" points="0,${py(lo).toFixed(1)} ${pts.join(' ')} 140,${py(lo).toFixed(1)}"/>` +
    `<polyline class="line" points="${pts.join(' ')}"/>`;
  const change = series[series.length - 1] - series[0];
  $('konto-note').textContent = change ? `${fmtSigned(change)} in 14 Tagen` : 'Letzte 14 Tage';

  // Freitag-Ziel
  const th = st.fridayThresholdMin;
  const isFri = parseDate(today).getDay() === 5;
  const bar = $('fri-bar');
  if (total >= th) {
    $('fri-value').textContent = 'Erreicht';
    bar.style.width = '100%';
    $('fri-note').textContent = 'Freitags darfst du früher gehen.';
  } else {
    $('fri-value').innerHTML = unit(fmtDur(th - total), 'Std. fehlen');
    bar.style.width = `${Math.max(0, (total / th) * 100).toFixed(1)}%`;
    $('fri-note').textContent =
      isFri && fridayAt !== undefined ? `Heute um ${fmtClock(fridayAt)} erreicht.` : `Ziel: ${fmtSigned(th)} auf dem Konto.`;
  }

  // Verdienst
  const p = pay(st);
  const todayNet = r && data.entries[today]?.kind === 'work' ? r.net : 0;
  const month = spanTotals(data.entries, st, today.slice(0, 8) + '01', today, today, nowMin);
  $('pay-value').textContent = fmtEuro((p.hourly * todayNet) / 60);
  const items: [string, string][] = [
    ['Diesen Monat', fmtEuro((p.hourly * month.net) / 60)],
    ['Wert des Kontos', `${total < 0 ? '−' : ''}${fmtEuro(Math.abs((p.hourly * total) / 60))}`],
    ['Stundenlohn', fmtEuro(p.hourly)],
  ];
  $('pay').innerHTML = items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const noSalary = p.hourly === 0;
  $('pay').hidden = noSalary;
  $('pay-note').textContent = noSalary ? 'Trag dein Nettogehalt in den Einstellungen ein, dann siehst du hier deinen Verdienst.' : 'heute verdient';
  if (noSalary) $('pay-value').textContent = '–';

  // Trends
  const mo = mondayOf(today);
  const thisAvg = avgWorkday(data.entries, st, mo, today);
  const lastAvg = avgWorkday(data.entries, st, addDays(mo, -7), addDays(mo, -1));
  const lines: [string, string][] = [];
  if (thisAvg !== undefined) {
    let txt = `Ø <strong>${fmtDur(thisAvg)}</strong> Std. pro Arbeitstag diese Woche`;
    let arrow = '•';
    if (lastAvg !== undefined && Math.round(thisAvg - lastAvg) !== 0) {
      const dlt = Math.round(thisAvg - lastAvg);
      arrow = dlt > 0 ? '↑' : '↓';
      txt += `, ${fmtDur(Math.abs(dlt))} ${dlt > 0 ? 'mehr' : 'weniger'} als letzte Woche`;
    }
    lines.push([arrow, txt + '.']);
  }
  const starts = Object.values(data.entries).filter(
    (e) => e.kind === 'work' && e.start !== undefined && e.date.slice(0, 7) === today.slice(0, 7),
  );
  if (starts.length >= 2) {
    const avgStart = starts.reduce((a, e) => a + e.start!, 0) / starts.length;
    lines.push(['⏱', `Im Schnitt stempelst du um <strong>${fmtClock(avgStart)}</strong> ein.`]);
  }
  if (month.days) lines.push([month.diff >= 0 ? '↑' : '↓', `${fmtMonth.format(parseDate(today))}: <strong>${fmtSigned(month.diff)}</strong> an ${month.days} ${month.days === 1 ? 'Tag' : 'Tagen'}.`]);
  $('trends').innerHTML = lines.length
    ? lines.map(([a, t]) => `<li><span class="arrow" aria-hidden="true">${a}</span><span>${t}</span></li>`).join('')
    : '<li><span class="arrow" aria-hidden="true">•</span><span>Stempel ein paar Tage, dann siehst du hier deine Trends.</span></li>';
}


// ---------- Wischen zum Löschen ----------

const SWIPE_OPEN = -96;
let openRow: HTMLElement | null = null;

function closeOpenRow() {
  if (!openRow) return;
  openRow.style.transform = '';
  openRow = null;
}

function enableSwipe(row: HTMLElement) {
  let x0 = 0, y0 = 0, base = 0, dx = 0, mode: 'idle' | 'maybe' | 'drag' = 'idle';
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    x0 = e.clientX;
    y0 = e.clientY;
    base = openRow === row ? SWIPE_OPEN : 0;
    dx = 0;
    mode = 'maybe';
    delete row.dataset.swiped;
  });
  row.addEventListener('pointermove', (e) => {
    if (mode === 'idle') return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (mode === 'maybe') {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) return void (mode = 'idle'); // senkrecht scrollen
      if (Math.abs(mx) < 8) return;
      mode = 'drag';
      row.setPointerCapture(e.pointerId);
      row.classList.add('dragging');
      if (openRow && openRow !== row) closeOpenRow();
    }
    dx = Math.min(0, Math.max(base + mx, SWIPE_OPEN * 1.4));
    row.style.transform = `translateX(${dx}px)`;
  });
  const end = () => {
    if (mode === 'drag') {
      row.dataset.swiped = '1';
      row.classList.remove('dragging');
      if (dx < SWIPE_OPEN / 2) {
        row.style.transform = `translateX(${SWIPE_OPEN}px)`;
        openRow = row;
      } else {
        row.style.transform = '';
        if (openRow === row) openRow = null;
      }
      setTimeout(() => delete row.dataset.swiped, 50);
    } else if (openRow === row) {
      // Tipp auf eine offene Zeile schließt sie nur
      row.dataset.swiped = '1';
      closeOpenRow();
      setTimeout(() => delete row.dataset.swiped, 50);
    }
    mode = 'idle';
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
}

async function deleteEntry(date: string) {
  const prev = data.entries[date];
  if (!prev) return;
  delete data.entries[date];
  undo = { date, prev };
  openRow = null;
  await persist();
  toast('Eintrag gelöscht', true);
  render();
}

// ---------- Erinnerungen ----------

function planReminders(today: string, e: Entry | undefined, working: boolean, zeroAt?: number, fridayAt?: number) {
  const st = s();
  const list: Reminder[] = [];
  if (st.notify && working && e?.start !== undefined) {
    if (zeroAt !== undefined)
      list.push({ id: `${today}-zero`, at: dateAt(today, zeroAt), title: '0:00 erreicht', body: `Soll von ${fmtDur(st.sollMin)} geschafft, ab jetzt Plus.` });
    if (fridayAt !== undefined && fridayAt > (zeroAt ?? 0))
      list.push({ id: `${today}-fri`, at: dateAt(today, fridayAt), title: 'Freitag-Ziel erreicht', body: `Konto bei ${fmtSigned(st.fridayThresholdMin)}, du darfst gehen.` });
    list.push({
      id: `${today}-forgot`,
      at: dateAt(today, e.start + st.forgotAfterMin),
      title: 'Ausstempeln vergessen?',
      body: `Du bist seit ${fmtClock(e.start)} eingestempelt.`,
    });
  }
  schedule(list, (r) => toast(`${r.title}. ${r.body}`));
}

function addIcs(today: string, zeroAt: number, fridayAt?: number) {
  const target = fridayAt !== undefined && fridayAt > zeroAt ? fridayAt : zeroAt;
  const r: Reminder = {
    id: `${today}-cal`,
    at: dateAt(today, target),
    title: target === fridayAt ? 'Freitag-Ziel erreicht' : 'Feierabend: 0:00 erreicht',
    body: 'Erinnerung aus dem Arbeitszeitrechner. Ausstempeln nicht vergessen.',
  };
  download(icsFor(r), `feierabend-${today}.ics`);
}

// ---------- Tag bearbeiten ----------

let editDate = '';
let editKind: DayKind = 'work';

const daySheet = $<HTMLDialogElement>('day-sheet');
const settingsSheet = $<HTMLDialogElement>('settings-sheet');
setupSheet(daySheet);
setupSheet(settingsSheet);

const TICK = '<svg class="tick" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function openDay(date: string) {
  editDate = date;
  closeOpenRow();
  const e = data.entries[date];
  editKind = e?.kind ?? 'work';
  $('day-title').textContent = fmtSheet.format(parseDate(date));
  const kinds = $('day-kinds');
  kinds.replaceChildren();
  (Object.keys(KIND_LABEL) as DayKind[]).forEach((k) => {
    const l = document.createElement('label');
    l.className = 'cell check-cell';
    l.innerHTML = `<span>${KIND_LABEL[k]}</span><input type="radio" name="kind" value="${k}" ${k === editKind ? 'checked' : ''}/>${TICK}`;
    l.querySelector('input')!.addEventListener('change', () => {
      editKind = k;
      $('day-times').hidden = k !== 'work';
    });
    kinds.append(l);
  });
  $<HTMLInputElement>('day-start').value = e?.start !== undefined ? fmtClock(e.start) : '';
  $<HTMLInputElement>('day-end').value = e?.end !== undefined ? fmtClock(e.end) : '';
  $('day-times').hidden = editKind !== 'work';
  $('day-error').textContent = '';
  $('day-delete').parentElement!.hidden = !e;
  openSheet(daySheet);
}

$('day-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const start = parseClock($<HTMLInputElement>('day-start').value);
  const end = parseClock($<HTMLInputElement>('day-end').value);
  let entry: Entry = { date: editDate, kind: editKind };
  if (editKind === 'work') {
    if (start === undefined) {
      $('day-error').textContent = 'Trag die Einstempelzeit ein.';
      $('day-start').focus();
      return;
    }
    if (end !== undefined && end === start) {
      $('day-error').textContent = 'Ein- und Ausstempelzeit sind gleich.';
      return;
    }
    entry = { ...entry, start, end };
  }
  data.entries[editDate] = entry;
  await persist();
  closeSheet(daySheet);
  render();
});
$('day-delete').addEventListener('click', async () => {
  closeSheet(daySheet);
  await deleteEntry(editDate);
});

// ---------- Einstellungen ----------

const settingsForm = $<HTMLFormElement>('settings-form');
const field = (n: string) => settingsForm.elements.namedItem(n) as HTMLInputElement;

function breakFoot() {
  const legal = (settingsForm.querySelector('input[name="breakMode"]:checked') as HTMLInputElement | null)?.value === 'legal';
  const u18 = field('under18').checked;
  $('break-foot').textContent = legal
    ? u18
      ? 'Gesetzlich unter 18: 30 Min. ab 4,5 Std., 60 Min. ab 6 Std. Arbeitszeit.'
      : 'Gesetzlich: 30 Min. ab 6 Std., 45 Min. ab 9 Std. Arbeitszeit.'
    : `Pauschal: jeden Tag ${u18 ? '60' : '30'} Min. Pause abziehen.`;
}

function openSettings() {
  const st = s();
  const el = field;
  el('under18').checked = st.under18;
  (settingsForm.querySelector(`input[name="breakMode"][value="${st.breakMode}"]`) as HTMLInputElement).checked = true;
  (settingsForm.querySelector(`input[name="theme"][value="${st.theme}"]`) as HTMLInputElement).checked = true;
  el('soll').value = fmtClock(st.sollMin);
  el('startBalance').value = fmtSigned(st.startBalanceMin);
  el('fridayThreshold').value = fmtClock(st.fridayThresholdMin);
  el('netSalary').value = String(st.netSalary);
  el('weeklyHours').value = String(st.weeklyHours);
  el('notify').checked = st.notify;
  el('forgotAfter').value = fmtClock(st.forgotAfterMin);
  $('settings-error').textContent = '';
  breakFoot();
  openSheet(settingsSheet);
}

$('open-settings').addEventListener('click', openSettings);
settingsForm.addEventListener('submit', (ev) => ev.preventDefault());

// Wie in iOS: jede Änderung gilt sofort, ohne „Speichern“
settingsForm.addEventListener('change', async (ev) => {
  const target = ev.target as HTMLInputElement;
  if (target.id === 'import-json') return;
  const el = field;
  const err = $('settings-error');
  breakFoot();
  const soll = parseClock(el('soll').value);
  const startBalance = parseSigned(el('startBalance').value || '0');
  if (soll === undefined) {
    err.textContent = 'Trag ein Soll pro Tag ein, z. B. 07:42.';
    return el('soll').focus();
  }
  if (startBalance === undefined) {
    err.textContent = 'Startsaldo bitte als +12:30 oder −1:15 eintragen.';
    return el('startBalance').focus();
  }
  err.textContent = '';
  // Ohne Browser-Erlaubnis bleiben die Hinweise in der App aktiv
  if (target.name === 'notify' && target.checked && !(await requestPermission()))
    toast('Benachrichtigungen sind blockiert. Hinweise erscheinen nur in der App.');
  data.settings = {
    under18: el('under18').checked,
    breakMode: (settingsForm.querySelector('input[name="breakMode"]:checked') as HTMLInputElement).value as Settings['breakMode'],
    sollMin: soll,
    startBalanceMin: startBalance,
    netSalary: Number(el('netSalary').value) || 0,
    weeklyHours: Number(el('weeklyHours').value) || 0,
    fridayThresholdMin: parseClock(el('fridayThreshold').value) ?? s().fridayThresholdMin,
    forgotAfterMin: parseClock(el('forgotAfter').value) ?? s().forgotAfterMin,
    notify: el('notify').checked,
    theme: (settingsForm.querySelector('input[name="theme"]:checked') as HTMLInputElement).value as Settings['theme'],
  };
  if (target.name === 'startBalance') target.value = fmtSigned(startBalance);
  if (target.name === 'theme') applyTheme();
  await persist();
  render();
});

$('export-json').addEventListener('click', () => download(exportJSON(data), `arbeitszeit-sicherung-${now().today}.json`));
$('export-csv').addEventListener('click', () => {
  const st = s();
  const lines = ['Datum;Art;Ein;Aus;Brutto;Pause;Netto;Soll;Differenz'];
  for (const e of entriesSorted(data.entries)) {
    const r = dayResult(e, st);
    lines.push(
      [e.date, KIND_LABEL[e.kind], e.start !== undefined ? fmtClock(e.start) : '', e.end !== undefined ? fmtClock(e.end) : '',
        fmtDur(r.gross), fmtDur(r.brk), fmtDur(r.net), fmtDur(r.soll), r.open ? 'offen' : fmtSigned(r.diff).replace('−', '-')].join(';'),
    );
  }
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }), `arbeitszeit-${now().today}.csv`);
});
$<HTMLInputElement>('import-json').addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const imported = parseImport(await file.text());
    if (!confirm(`Sicherung mit ${Object.keys(imported.entries).length} Tagen laden? Die aktuellen Daten werden ersetzt.`)) return;
    data = imported;
    applyTheme();
    await persist();
    closeSheet(settingsSheet);
    toast('Sicherung geladen');
    render();
  } catch {
    $('settings-error').textContent = 'Die Datei ist keine Sicherung dieser App.';
  } finally {
    (ev.target as HTMLInputElement).value = '';
  }
});

// ---------- Start ----------

$('stamp').addEventListener('click', punch);
$('week-prev').addEventListener('click', () => {
  viewWeek = addDays(viewWeek, -7);
  render();
});
$('week-next').addEventListener('click', () => {
  viewWeek = addDays(viewWeek, 7);
  render();
});
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && render());
document.addEventListener('pointerdown', (e) => {
  if (openRow && !(e.target as HTMLElement).closest('.rows li')) closeOpenRow();
});

// Großer Titel scrollt weg → Glasleiste mit kleinem Titel
new IntersectionObserver(([en]) => $('nav').classList.toggle('scrolled', !en.isIntersecting), {
  rootMargin: '-48px 0px 0px 0px',
}).observe($('large-title'));

(async () => {
  data = await load();
  applyTheme();
  viewWeek = mondayOf(now().today);
  render();
  // Schnellstart über App-Shortcut: ?stempeln
  const url = new URL(location.href);
  if (url.searchParams.has('stempeln')) {
    url.searchParams.delete('stempeln');
    history.replaceState(null, '', url);
    await punch();
  }
  // Minütlich aktualisieren, synchron zur vollen Minute
  const tick = () => {
    render();
    setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
  };
  setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
})();
