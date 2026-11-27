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
  let pending, previous, navigated;
  let navigation = 0;
  function update() {
    const viewport = document.getElementById('typst-container-main');
    const pages = [...document.querySelectorAll(pageSelector)];
    if (!viewport || !pages.length) return;
    const bounds = viewport.getBoundingClientRect();
    if (!bounds.height) return;
    let current = 1, total = 0, visible = -1, selectedVisible = false;
    for (const page of pages) {
      const number = Number(page.getAttribute('data-page-number')) + 1;
      total = Math.max(total, number);
      const rect = page.getBoundingClientRect();
      const height = Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top));
      if (number === navigated?.page && height > 0) selectedVisible = true;
      if (height > visible) { visible = height; current = number; }
    }
    // Keep an explicit selection across pixel rounding and clamped scrolling at the end.
    if (navigated && Math.abs(viewport.scrollTop - navigated.top) < 1 && selectedVisible) current = navigated.page;
    else navigated = undefined;
    const value = current + '/' + total + '/' + navigation;
    if (value === previous) return;
    previous = value;
    parent.postMessage({ type: 'pageProgress', token, current, total, navigation }, '*');
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
      if (Number.isInteger(event.data.navigation) && event.data.navigation >= 0) navigation = event.data.navigation;
      const page = [...document.querySelectorAll(pageSelector)].find(page => Number(page.getAttribute('data-page-number')) === number - 1);
      const viewport = document.getElementById('typst-container-main');
      if (page && viewport) {
        viewport.scrollTo({ top: viewport.scrollTop + page.getBoundingClientRect().top - viewport.getBoundingClientRect().top, behavior: 'instant' });
        navigated = { page: number, top: viewport.scrollTop };
      }
      update();
      return;
    }
    if (typeof event.data.scrollbarForeground === 'string') document.documentElement.style.setProperty('--vscode-foreground', event.data.scrollbarForeground);
    document.documentElement.classList.toggle('exercices-jumps', !!event.data.jumps);
    if (!event.data.jumps) { document.querySelectorAll('.hover').forEach(e => e.classList.remove('hover')); getSelection()?.removeAllRanges(); }
    schedule();
  });
  function extractClickContext(event) {
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    const page = target?.closest?.(pageSelector);
    if (!page) return;
    const nodes = [...page.querySelectorAll('.tsel, .typst-html-semantics span')].filter(el => !el.querySelector?.('.tsel, span') && (el.textContent || '').trim().length > 0);
    if (!nodes.length) return;
    const items = nodes.map(el => ({ el, text: el.textContent || '', rect: el.getBoundingClientRect() })).filter(item => item.rect.width > 0 && item.rect.height > 0);
    if (!items.length) return;
    let hit = items.find(item => item.el === target || item.el.contains?.(target));
    if (!hit) {
      let bestDist = Infinity;
      for (const item of items) {
        const dx = Math.max(item.rect.left - event.clientX, 0, event.clientX - item.rect.right);
        const dy = Math.max(item.rect.top - event.clientY, 0, event.clientY - item.rect.bottom);
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) { bestDist = dist; hit = item; }
      }
      if (!hit || bestDist > 400) return;
    }
    const rowTol = Math.max(4, hit.rect.height * 0.5);
    const rows = [];
    for (const item of items.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)) {
      let row = rows.find(r => Math.abs(r.top - item.rect.top) <= rowTol);
      if (!row) { row = { top: item.rect.top, items: [] }; rows.push(row); }
      row.items.push(item);
    }
    const segments = [];
    for (const row of rows) {
      row.items.sort((a, b) => a.rect.left - b.rect.left);
      let seg = null;
      for (const item of row.items) {
        const gap = seg ? item.rect.left - seg.right : 0;
        const maxGap = Math.max(24, item.rect.height * 2.5);
        if (!seg || gap > maxGap) {
          seg = { top: row.top, left: item.rect.left, right: item.rect.right, text: item.text, hasHit: item === hit };
          segments.push(seg);
        } else {
          if (gap > Math.max(2, item.rect.height * 0.25) && !seg.text.endsWith(' ') && !item.text.startsWith(' ')) seg.text += ' ';
          seg.text += item.text;
          seg.right = Math.max(seg.right, item.rect.right);
          if (item === hit) seg.hasHit = true;
        }
      }
    }
    const hitSeg = segments.find(s => s.hasHit);
    if (!hitSeg) return;
    const colSegs = segments.filter(s => s.right >= hitSeg.left - 20 && s.left <= hitSeg.right + 20).sort((a, b) => a.top - b.top);
    const idx = colSegs.indexOf(hitSeg);
    const before = colSegs.slice(Math.max(0, idx - 3), idx).map(s => s.text.trim()).filter(Boolean);
    const after = colSegs.slice(idx + 1, idx + 4).map(s => s.text.trim()).filter(Boolean);
    return { line: hitSeg.text.trim(), before, after };
  }
  addEventListener('click', event => {
    if (!document.documentElement.classList.contains('exercices-jumps') || getSelection?.()?.toString()) return;
    const context = extractClickContext(event);
    if (context?.line) parent.postMessage({ type: 'clickContext', token, ...context }, '*');
  }, true);
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
