// Nur für die Entwicklung: App im Handyrahmen, Quellcode daneben (wird nicht mitgebaut).
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './showcase.css';
import mainSrc from './main.ts?raw';
import coreSrc from './core.ts?raw';
import storeSrc from './store.ts?raw';
import remindersSrc from './reminders.ts?raw';
import stylesSrc from './styles.css?raw';
import htmlSrc from '../index.html?raw';

const files: [string, string, 'ts' | 'css' | 'html'][] = [
  ['main.ts', mainSrc, 'ts'],
  ['core.ts', coreSrc, 'ts'],
  ['styles.css', stylesSrc, 'css'],
  ['index.html', htmlSrc, 'html'],
  ['reminders.ts', remindersSrc, 'ts'],
  ['store.ts', storeSrc, 'ts'],
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const RULES: Record<string, RegExp> = {
  ts: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|\b(import|from|export|const|let|function|return|if|else|for|of|in|async|await|new|type|interface|try|catch|finally|continue|void|typeof|true|false|undefined|null)\b|\b(\d+(?:\.\d+)?)\b/g,
  css: /(\/\*[\s\S]*?\*\/)|('(?:[^'\n])*'|"(?:[^"\n])*")|(@media|@keyframes|!important)|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vw|s|fr|dvh)?\b)/g,
  html: /(<!--[\s\S]*?-->)|("(?:[^"\n])*")|(<\/?[a-zA-Z][\w-]*|\/?>)|(\b\d+\b)/g,
};
const CLS = ['', 'c', 's', 'k', 'n'];

function highlight(src: string, lang: string): string {
  const re = RULES[lang];
  let out = '';
  let last = 0;
  for (const m of src.matchAll(re)) {
    out += esc(src.slice(last, m.index));
    const g = m.findIndex((v, i) => i > 0 && v !== undefined);
    out += `<span class="${CLS[g]}">${esc(m[0])}</span>`;
    last = m.index! + m[0].length;
  }
  return out + esc(src.slice(last));
}

const tabs = document.getElementById('tabs')!;
const code = document.querySelector('#code code') as HTMLElement;

function show(i: number) {
  const [, src, lang] = files[i];
  const lines = highlight(src.replace(/\r\n/g, '\n'), lang).split('\n');
  code.innerHTML = lines.map((l) => `<span class="ln">${l || ' '}</span>`).join('');
  tabs.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
  document.getElementById('code')!.scrollTop = 0;
  try {
    localStorage.setItem('showcase-tab', String(i));
  } catch {
    /* egal */
  }
}

files.forEach(([name, src], i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'tab');
  b.innerHTML = `${name} <small>${src.split('\n').length}</small>`;
  b.addEventListener('click', () => show(i));
  tabs.append(b);
});

let start = 0;
try {
  start = Number(localStorage.getItem('showcase-tab')) || 0;
} catch {
  /* egal */
}
show(Math.min(start, files.length - 1));

document.getElementById('reload')!.addEventListener('click', () => {
  (document.getElementById('app') as HTMLIFrameElement).contentWindow?.location.reload();
});
