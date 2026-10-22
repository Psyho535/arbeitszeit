import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import {
  DayKind, Entry, KIND_LABEL, Settings, addDays, balanceBefore, balanceTotal, clockForNet, dayResult, entriesSorted,
  fmtClock, fmtDur, fmtEuro, fmtSigned, minutesOf, mondayOf, parseClock, parseDate, parseSigned, pay, toISO, weekDates,
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
  const bt = $('balance-top');
  bt.textContent = fmtSigned(total);
  bt.className = signClass(total);

  // Uhr
  const digits = $('clock-digits');
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
    status.textContent = `Netto heute, seit ${fmtClock(todayEntry.start!)} eingestempelt`;
    if (r.diff < 0) hint.innerHTML = `Bei 0:00 um <strong>${fmtClock(zeroAt!)}</strong>, noch ${fmtDur(-r.diff)}.`;
    else {
      hint.innerHTML = `Soll erreicht, heute <strong>${fmtSigned(r.diff)}</strong>.`;
      hint.classList.add('pos');
    }
    actions.append(actionBtn('Feierabend-Wecker in Kalender', () => addIcs(today, zeroAt!, fridayAt)));
  } else if (done && r) {
    digits.textContent = fmtDur(r.net);
    status.textContent = `Netto heute, ${fmtClock(todayEntry.start!)} bis ${fmtClock(todayEntry.end!)}`;
    hint.innerHTML = `Tagesergebnis <strong>${fmtSigned(r.diff)}</strong>, Pause ${fmtDur(r.brk)}.`;
    hint.classList.add(signClass(r.diff));
  } else if (todayEntry && todayEntry.kind !== 'work') {
    digits.textContent = fmtClock(min);
    status.textContent = `Heute eingetragen: ${KIND_LABEL[todayEntry.kind]}`;
    hint.textContent = 'Zählt als Soll, das Konto bleibt gleich.';
  } else {
    digits.textContent = fmtClock(min);
    status.textContent = r && r.soll === 0 ? 'Wochenende, jede Minute zählt als Plus' : 'Noch nicht eingestempelt';
    hint.textContent = '';
  }
  digits.setAttribute('aria-label', digits.textContent);
  renderDaybar(todayEntry, min, zeroAt, fridayAt);

  // Stempel-Knopf
  $('stamp-label').textContent = working ? 'Ausstempeln' : done ? 'Weiterarbeiten' : 'Einstempeln';
  $('stamp-time').textContent = fmtClock(min);
  $('stamp').classList.toggle('out', working);

  renderBanner(today);
  renderWeek(today, min);
  renderFacts(today, total, r, fridayAt);
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

function renderDaybar(e: Entry | undefined, nowMin: number, zeroAt?: number, fridayAt?: number) {
  const bar = $('daybar');
  if (!e || e.kind !== 'work' || e.start === undefined || zeroAt === undefined) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const endMin = e.end ?? nowMin;
  const from = e.start - 30;
  const to = Math.max(zeroAt, fridayAt ?? 0, endMin) + 45;
  const pct = (m: number) => `${(((m - from) / (to - from)) * 100).toFixed(2)}%`;
  const overStart = Math.min(Math.max(endMin, e.start), zeroAt);
  const marks: string[] = [
    `<span class="mark start" style="left:${pct(e.start)}"><span>${fmtClock(e.start)}</span></span>`,
    `<span class="mark zero" style="left:${pct(zeroAt)}"><span>0:00 um ${fmtClock(zeroAt)}</span></span>`,
  ];
  if (fridayAt !== undefined && fridayAt > zeroAt)
    marks.push(`<span class="mark fri" style="left:${pct(fridayAt)}"><span>Freitag-Ziel ${fmtClock(fridayAt)}</span></span>`);
  bar.innerHTML = `
    <div class="track">
      <span class="fill" style="left:${pct(e.start)};width:calc(${pct(overStart)} - ${pct(e.start)})"></span>
      ${endMin > zeroAt ? `<span class="fill over" style="left:${pct(zeroAt)};width:calc(${pct(endMin)} - ${pct(zeroAt)})"></span>` : ''}
      ${e.end === undefined ? `<span class="now" style="left:${pct(endMin)}"></span>` : ''}
    </div>
    <div class="marks">${marks.join('')}</div>`;
  bar.setAttribute('role', 'img');
  bar.setAttribute(
    'aria-label',
    `Tagesverlauf: eingestempelt ${fmtClock(e.start)}, 0:00 erreicht um ${fmtClock(zeroAt)}` +
      (fridayAt !== undefined ? `, Freitag-Ziel um ${fmtClock(fridayAt)}` : ''),
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
}

function renderFacts(today: string, total: number, r: ReturnType<typeof dayResult> | undefined, fridayAt?: number) {
  const st = s();
  const fri = $('friday');
  const isFri = parseDate(today).getDay() === 5;
  const th = st.fridayThresholdMin;
  fri.className = 'friday';
  if (total >= th) {
    fri.textContent = `Konto ${fmtSigned(total)}: Freitags darfst du früher gehen.`;
    fri.classList.add('pos');
  } else if (isFri && fridayAt !== undefined) {
    fri.textContent = `Freitag: ${fmtSigned(th)} Plus erreichst du um ${fmtClock(fridayAt)}.`;
  } else {
    fri.textContent = `Bis zu ${fmtSigned(th)} für früheres Gehen am Freitag fehlen ${fmtDur(th - total)}.`;
  }
  const p = pay(st);
  const todayNet = r && data.entries[today]?.kind === 'work' ? r.net : 0;
  const items: [string, string][] = [
    ['Stundenlohn netto', fmtEuro(p.hourly)],
    ['Heute verdient', fmtEuro((p.hourly * todayNet) / 60)],
    ['Monatsstunden', `${p.monthlyHours.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Std.`],
    ['Wert des Kontos', `${total < 0 ? '−' : ''}${fmtEuro(Math.abs((p.hourly * total) / 60))}`],
  ];
  $('pay').innerHTML = items.map(([k, v]) => `<div class="cell"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
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
  };
  if (target.name === 'startBalance') target.value = fmtSigned(startBalance);
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
