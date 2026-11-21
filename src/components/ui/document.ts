import { render, type VNode } from 'preact';
import { SITE_URL } from '../../config';
import { escapeHtml } from '../../lib/reports/export';
// Applied to the page for printing; each document's .html file carries it as text, with its own styles.
import './document.css';
import paperCss from './document.css?raw';

/**
 * Prints a document instead of the page: it's rendered at the end of the body, alone on paper (document.css), and
 * removed once the print window closes. The page title becomes the PDF's suggested file name meanwhile.
 */
export function printDocument(doc: VNode, title: string) {
  document.querySelector('.print-host')?.remove();
  const host = document.createElement('div');
  host.className = 'print-host';
  document.body.append(host);
  render(doc, host);
  const root = document.documentElement;
  const pageTitle = document.title;
  root.classList.add('printing');
  document.title = title;
  const done = () => {
    removeEventListener('afterprint', done);
    root.classList.remove('printing');
    document.title = pageTitle;
    render(null, host);
    host.remove();
  };
  addEventListener('afterprint', done);
  print();
}

/**
 * A document rendered once, off the page, as an element to read from: links within the site point to the site (the
 * file or the text is read elsewhere).
 */
export function renderDocument<T>(doc: VNode, read: (host: HTMLElement) => T): T {
  const host = document.createElement('div');
  render(doc, host);
  for (const a of host.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) a.href = new URL(a.getAttribute('href')!, SITE_URL).href;
  try {
    return read(host);
  } finally {
    render(null, host);
  }
}

/**
 * The same document as a standalone .html file that opens in any browser: the paper's styles and `css` (the
 * document's own) inside.
 */
export function documentFile(doc: VNode, title: string, lang: string, css = ''): string {
  const body = renderDocument(doc, (host) => host.innerHTML);
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${paperCss}${css}</style>`,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Saves `text` as a file on the visitor's device: nothing leaves it. */
export function downloadFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
