// Blatt von unten wie in iOS: öffnet federnd, schließt per „Abbrechen/Fertig“,
// Escape, Tipp daneben oder Herunterziehen am Kopf.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function openSheet(d: HTMLDialogElement): void {
  d.classList.remove('closing');
  d.style.transform = '';
  d.showModal();
}

export function closeSheet(d: HTMLDialogElement): void {
  if (!d.open || d.classList.contains('closing')) return;
  if (reduced()) return d.close();
  d.style.transform = '';
  d.classList.add('closing');
  d.addEventListener(
    'animationend',
    () => {
      d.classList.remove('closing');
      d.close();
    },
    { once: true },
  );
}

export function setupSheet(d: HTMLDialogElement): void {
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeSheet(d);
  });
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet(d)));
  // Tipp auf den abgedunkelten Hintergrund
  d.addEventListener('click', (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) closeSheet(d);
  });

  // Herunterziehen am Kopf
  const head = d.querySelector<HTMLElement>('.sheet-head');
  if (!head) return;
  let startY = 0, dy = 0, t0 = 0, dragging = false;
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    startY = e.clientY;
    dy = 0;
    t0 = performance.now();
    head.setPointerCapture(e.pointerId);
    d.style.transition = 'none';
  });
  head.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    d.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const velocity = dy / Math.max(performance.now() - t0, 1); // px/ms
    d.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
    if (dy > 140 || velocity > 0.6) {
      d.style.transform = 'translateY(100%)';
      d.addEventListener(
        'transitionend',
        () => {
          d.close();
          d.style.transition = '';
          d.style.transform = '';
        },
        { once: true },
      );
    } else {
      d.style.transform = '';
    }
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
}
