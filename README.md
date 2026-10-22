# Arbeitszeit

Stempeluhr als App für Handy und PC: ein Tipp zum Ein- und Ausstempeln, Zeitkonto,
Freitagsregel, Verdienst und Erinnerungen. Läuft offline, alle Daten bleiben auf dem Gerät.

## Was die App kann

- **Stempeln mit einem Tipp** – großer Knopf unten, nimmt die aktuelle Uhrzeit. Fehlgriff? „Rückgängig“ im Hinweis.
- **App-Shortcut „Stempeln“** – lange auf das App-Icon drücken → „Stempeln“: stempelt sofort ein bzw. aus.
- **Live-Uhr und Tagesbalken** – Nettozeit läuft mit, der Balken zeigt Einstempeln, „0:00 erreicht“ und (freitags) das 3-Std.-Ziel.
- **Zeitkonto ohne Rechnen** – jeder Tag wird gespeichert, das Konto rechnet sich selbst fort. Startsaldo einmal in den Einstellungen eintragen.
- **Tagesarten** – Arbeit, Berufsschule, Urlaub, Krank, Feiertag (zählen als Soll erfüllt). Tippe auf einen Tag in der Woche zum Nachtragen oder Korrigieren.
- **Erinnerungen** – Benachrichtigung bei 0:00, wenn das Freitag-Ziel erreicht ist und wenn du vergessen hast auszustempeln.
- **Auswertung** – Wochen blättern, Monatssumme, Export als CSV (Excel) und JSON-Sicherung zum Wiederherstellen.
- **Pausenregel** – pauschal wie bisher (30 Min., unter 18: 60 Min.) oder gesetzlich gestaffelt (Einstellungen).

### Grenzen der Erinnerungen

Web-Apps dürfen nur Benachrichtigungen zeigen, solange sie geöffnet sind oder kurz im
Hintergrund laufen. Für eine sichere Erinnerung bei geschlossener App: nach dem Einstempeln
**„Feierabend-Wecker in Kalender“** tippen – das legt einen Termin mit Alarm im Handy-Kalender an.

## Aufs Handy bringen (kostenlos, GitHub Pages)

1. Auf GitHub ein neues Repository anlegen (z. B. `arbeitszeit`), dieses Projekt hochladen:
   ```bash
   git remote add origin https://github.com/DEIN-NAME/arbeitszeit.git
   ```
   ```bash
   git push -u origin main
   ```
2. Im Repository: **Settings → Pages → Source: GitHub Actions**. Der Workflow baut und veröffentlicht automatisch.
3. Nach ca. 1 Minute ist die App unter `https://DEIN-NAME.github.io/arbeitszeit/` erreichbar.
4. Auf dem Handy öffnen und installieren:
   - **iPhone (Safari):** Teilen → „Zum Home-Bildschirm“.
   - **Android (Chrome):** Menü ⋮ → „App installieren“.
5. Beim ersten Mal in den Einstellungen Soll, Startsaldo, Gehalt und ggf. Erinnerungen setzen.

Die Daten liegen pro Gerät/Browser. Zum Umziehen: Einstellungen → „Sicherung herunterladen“ und auf dem anderen Gerät „Sicherung laden“.

## Entwickeln

```bash
npm.cmd install
```
```bash
npm.cmd run dev
```
```bash
npm.cmd test
```
```bash
npm.cmd run build
```

- `src/core.ts` – Rechenlogik (Pausen, Soll, Konto, Freitagsregel, Lohn), getestet in `src/core.test.ts`
- `src/main.ts` – Oberfläche und Stempeln
- `src/store.ts` – Speicherung (IndexedDB), Export/Import
- `src/reminders.ts` – Benachrichtigungen und Kalender-Wecker (.ics)
- `src/sheet.ts` – Blätter von unten (iOS-Stil, zum Schließen herunterziehen)
- `src/styles.css` – Gestaltung (iOS-Listen, Glasleisten, Stempeluhr-Ziffern, Bernstein, Graphit im dunklen Modus)
