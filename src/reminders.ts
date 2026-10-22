// Erinnerungen: Systembenachrichtigung, solange die App läuft, sonst Hinweis in der App.
// Für geschlossene App: Kalendertermin (.ics) mit Alarm, den der Handy-Kalender auslöst.

export interface Reminder {
  id: string;
  at: Date;
  title: string;
  body: string;
}

const timers = new Map<string, number>();
const fired = new Set<string>();

export function notificationsSupported(): boolean {
  return 'Notification' in window;
}

export async function requestPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

async function show(r: Reminder, inApp: (r: Reminder) => void): Promise<void> {
  inApp(r);
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(r.title, { body: r.body, tag: r.id, icon: '/icon-192.png', badge: '/icon-192.png' });
    else new Notification(r.title, { body: r.body, tag: r.id });
  } catch {
    /* Hinweis in der App genügt */
  }
}

/** Ersetzt alle geplanten Erinnerungen. Bereits ausgelöste (gleiche id) feuern nicht erneut. */
export function schedule(list: Reminder[], inApp: (r: Reminder) => void): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  const now = Date.now();
  for (const r of list) {
    if (fired.has(r.id)) continue;
    const delay = r.at.getTime() - now;
    if (delay < -60_000) continue; // längst vorbei
    timers.set(
      r.id,
      window.setTimeout(() => {
        fired.add(r.id);
        void show(r, inApp);
      }, Math.max(delay, 0)),
    );
  }
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function icsFor(r: Reminder): Blob {
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const end = new Date(r.at.getTime() + 5 * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Arbeitszeitrechner//DE',
    'BEGIN:VEVENT',
    `UID:${r.id}-${r.at.getTime()}@arbeitszeitrechner`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(r.at)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${esc(r.title)}`,
    `DESCRIPTION:${esc(r.body)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(r.title)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return new Blob([lines.join('\r\n')], { type: 'text/calendar' });
}
