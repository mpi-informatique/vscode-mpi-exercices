import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { scrollbarStyle } from './scrollbars';

// The upstream page owns hover effects; blocking only LSP jumps cannot disable them.
export function bridgeHtml(html: string, upstream: string, token: string): string {
  return html.replaceAll('new URL("/", window.location.href)', `new URL("/", ${JSON.stringify(upstream)})`)
    .replaceAll('.hover .typst-text {', 'html.exercices-jumps .hover .typst-text {')
    .replaceAll('.typst-text:hover {', 'html.exercices-jumps .typst-text:hover {')
    .replace('</head>', `<style>
${scrollbarStyle}
html, body { width: 100%; height: 100%; overflow: hidden; }
#typst-container, #typst-container-main { min-width: 0; min-height: 0; }
html:not(.exercices-jumps) .typst-jump-ripple,html:not(.exercices-jumps) .typst-debug-react-ripple{display:none!important}
</style>
<script>
(() => {
  const token = ${JSON.stringify(token)};
  const pageSelector = '#typst-app .typst-page-inner[data-page-number], #typst-app .typst-page.canvas-mode[data-page-number]';
  let pending, previous;
  function update() {
    const viewport = document.getElementById('typst-container-main');
    const pages = [...document.querySelectorAll(pageSelector)];
    if (!viewport || !pages.length) return;
    const bounds = viewport.getBoundingClientRect();
    if (!bounds.height) return;
    let current = 1, total = 0, visible = -1;
    for (const page of pages) {
      const number = Number(page.getAttribute('data-page-number')) + 1;
      total = Math.max(total, number);
      const rect = page.getBoundingClientRect();
      const height = Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top));
      if (height > visible) { visible = height; current = number; }
    }
    const value = current + '/' + total;
    if (value === previous) return;
    previous = value;
    parent.postMessage({ type: 'pageProgress', token, current, total }, '*');
  }
  function schedule() { cancelAnimationFrame(pending); pending = requestAnimationFrame(update); }
  addEventListener('scroll', schedule, { capture: true, passive: true });
  addEventListener('resize', schedule);
  addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('typst-app');
    if (app) new MutationObserver(schedule).observe(app, { childList: true, subtree: true, attributes: true });
    schedule();
  });
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.token !== token) return;
    if (event.data.type === 'goToPage') {
      const number = event.data.page;
      if (!Number.isInteger(number) || number < 1) return;
      const page = [...document.querySelectorAll(pageSelector)].find(page => Number(page.getAttribute('data-page-number')) === number - 1);
      const viewport = document.getElementById('typst-container-main');
      if (page && viewport) viewport.scrollTo({ top: viewport.scrollTop + page.getBoundingClientRect().top - viewport.getBoundingClientRect().top });
      schedule();
      return;
    }
    if (typeof event.data.scrollbarForeground === 'string') document.documentElement.style.setProperty('--vscode-foreground', event.data.scrollbarForeground);
    document.documentElement.classList.toggle('exercices-jumps', !!event.data.jumps);
    if (!event.data.jumps) { document.querySelectorAll('.hover').forEach(e => e.classList.remove('hover')); getSelection()?.removeAllRanges(); }
    schedule();
  });
  addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (['F5', 'F6', 'F7'].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      parent.postMessage({ type: 'selectVariant', token, variant: event.key === 'F5' ? 'enonce' : event.key === 'F6' ? 'corrige' : 'presentation' }, '*');
      return;
    }
    if (event.target.closest?.('input, textarea, [contenteditable="true"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (['Home', 'End'].includes(event.key)) {
      parent.postMessage({ type: 'pageBoundary', token, boundary: event.key === 'Home' ? 'start' : 'end' }, '*');
    } else {
      parent.postMessage({ type: 'pageStep', token, delta: event.key === 'ArrowRight' ? 1 : -1 }, '*');
    }
  }, true);
})();
</script></head>`);
}
export async function bridge(port: number, token: string): Promise<{ url: string; dispose(): void }> {
  const upstream = `http://127.0.0.1:${port}`;
  const server = createServer(async (request, response) => {
    try {
      if (request.url !== '/' + token) { response.writeHead(404).end(); return; }
      const remote = await fetch(upstream);
      if (!remote.ok) throw new Error('Aperçu indisponible');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(bridgeHtml(await remote.text(), upstream, token));
    } catch { response.writeHead(502).end('Aperçu indisponible'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/${token}`, dispose: () => { server.closeAllConnections(); server.close(); } };
}
