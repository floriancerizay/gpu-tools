import './app.css';
import type { Tool } from './ui';

const tools: Record<string, () => Promise<Tool>> = {
  generator: () => import('./tools/generator/view'),
  shrink: () => import('./tools/shrink/view'),
  fix: () => import('./tools/fix/view'),
};
const DEFAULT = 'generator';

const view = document.getElementById('view')!;
let current = '';

async function route() {
  const id = location.hash.replace(/^#\//, '');
  const name = id in tools ? id : DEFAULT;
  if (name === current) return;
  current = name;
  document.querySelectorAll<HTMLAnchorElement>('nav a').forEach((a) => {
    if (a.dataset.tool === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const tool = await tools[name]();
  if (current !== name) return; // navigation entre-temps
  view.replaceChildren();
  await tool.mount(view);
}

window.addEventListener('hashchange', route);
route();
