/**
 * Gera docs/manual/manual-completo.pdf a partir dos markdowns do manual: capa, sumário,
 * capítulos em páginas novas, imagens embutidas e numeração. Usa `marked` e o Chromium
 * do Playwright (nada instalado fora do pnpm). Uso: `pnpm manual:pdf`.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { Marked } from 'marked';
import { CHAPTERS, DISCLAIMER, IMG_DIR, MANUAL_DIR, PDF_NAME, ROOT, checkManual, headingsOf, loadManual } from './manual-lib.mjs';

const TITLE = 'FertilizaCerrado — Manual do usuário';
const SUBTITLE = 'Cadastro, propriedades, talhões, safras e o painel agrometeorológico (Fases 0 e 1)';
const SCALE = 1.5; // deviceScaleFactor da captura
const CONTENT_WIDTH_MM = 174; // A4 menos as margens laterais
const MAX_FIGURE_HEIGHT_MM = 215;
const FULL_WIDTH_CSS_PX = 900; // recortes a partir desta largura ocupam a página toda

const problems = checkManual();
if (problems.length > 0) {
  console.error(`PDF não gerado — manual inconsistente (${problems.length} problema(s)):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const chapterId = (file) => `c${file.slice(0, 2)}`;

function pngSize(file) {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }; // IHDR
}

/** Dimensões de um JPEG, lidas do marcador SOF. */
function jpegSize(file) {
  const buf = readFileSync(file);
  if (buf.readUInt16BE(0) !== 0xffd8) throw new Error(`não é JPEG: ${file}`);
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) throw new Error(`JPEG malformado: ${file}`);
    const marker = buf[i + 1];
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error(`JPEG sem marcador de dimensões: ${file}`);
}

/**
 * Imagens pesadas (as de satélite) entram no PDF como JPEG, convertidas pelo próprio
 * Chromium; as demais ficam em PNG, que preserva o texto das telas. Os arquivos de
 * docs/manual/img não são alterados.
 */
const JPEG_ABOVE_BYTES = 300 * 1024;
async function lighterCopies(files) {
  const heavy = files.filter((f) => statSync(f).size > JPEG_ABOVE_BYTES);
  const copies = new Map();
  if (heavy.length === 0) return copies;
  const dir = join(ROOT, 'frontend', 'test-results', 'manual', 'pdf-img');
  mkdirSync(dir, { recursive: true });
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ deviceScaleFactor: 1 });
    for (const file of heavy) {
      const name = basename(file);
      const size = pngSize(file);
      await page.setViewportSize({ width: size.width, height: 800 });
      // data URL: uma página aberta por setContent (about:blank) não pode carregar file://
      const src = `data:image/png;base64,${readFileSync(file).toString('base64')}`;
      await page.setContent(`<body style="margin:0"><img src="${src}" style="display:block;width:${size.width}px;height:${size.height}px"></body>`, { waitUntil: 'load' });
      const loaded = await page.locator('img').evaluate(async (img) => {
        await img.decode().catch(() => undefined);
        return { ok: img.complete && img.naturalWidth > 0, width: img.naturalWidth, height: img.naturalHeight };
      });
      if (!loaded.ok || loaded.width !== size.width || loaded.height !== size.height) {
        throw new Error(`conversão para o PDF: ${name} não carregou no navegador (obtido ${loaded.width}×${loaded.height}, esperado ${size.width}×${size.height})`);
      }
      const out = join(dir, `${basename(file, '.png')}.jpg`);
      await page.locator('img').screenshot({ path: out, type: 'jpeg', quality: 80 });
      const jpeg = jpegSize(out);
      if (jpeg.width !== size.width || jpeg.height !== size.height) {
        throw new Error(`conversão para o PDF: ${name} gerou JPEG de ${jpeg.width}×${jpeg.height}, mas o PNG tem ${size.width}×${size.height}`);
      }
      if (statSync(out).size < statSync(file).size) copies.set(file, out);
    }
  } finally {
    await b.close();
  }
  return copies;
}

/** Link do markdown → âncora interna do PDF (ou texto, para arquivos fora do manual). */
function rewriteLink(href, currentFile) {
  if (/^(https?:|mailto:)/.test(href)) return { href };
  const [target, hash] = href.split('#');
  if (target === 'README.md') return { href: '#sumario' };
  if (target === PDF_NAME) return { href: null };
  const file = target === '' ? currentFile : target;
  if (CHAPTERS.includes(file)) return { href: hash ? `#${chapterId(file)}-${decodeURIComponent(hash)}` : `#${chapterId(file)}` };
  return { href: null, note: `docs/${join('manual', target).replace(/^manual\/\.\.\//, '')}` };
}

function renderChapter(chapter, number) {
  const ids = headingsOf(chapter.text).map((h) => h.id);
  let headingIndex = 0;
  let figure = 0;
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const id = `${chapterId(chapter.file)}-${ids[headingIndex++]}`;
        const inner = this.parser.parseInline(tokens);
        return depth === 1 ? `<h1 id="${chapterId(chapter.file)}"><span class="chapter-number">Capítulo ${number}</span>${inner}</h1>\n` : `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      image({ href, text }) {
        figure++;
        const file = join(MANUAL_DIR, href);
        const size = pngSize(file);
        const byWidth = (size.width / SCALE / FULL_WIDTH_CSS_PX) * 100;
        const byHeight = ((MAX_FIGURE_HEIGHT_MM * size.width) / size.height / CONTENT_WIDTH_MM) * 100; // imagens altas: a largura respeita a altura máxima
        const width = Math.round(Math.min(100, byWidth, byHeight));
        return `<figure><img src="${pathToFileURL(copies.get(file) ?? file).href}" style="width:${width}%" alt="${escapeHtml(text)}"><figcaption>Figura ${number}.${figure} — ${escapeHtml(text)}</figcaption></figure>`;
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const out = rewriteLink(href, chapter.file);
        if (out.href) return `<a href="${escapeHtml(out.href)}">${inner}</a>`;
        return out.note ? `${inner} (<code>${escapeHtml(out.note)}</code>)` : inner;
      },
      paragraph({ tokens }) {
        const inner = this.parser.parseInline(tokens);
        return /^\s*<figure>/.test(inner) ? `${inner}\n` : `<p>${inner}</p>\n`; // figura não pode ficar dentro de <p>
      },
    },
  });
  return `<section class="chapter">${marked.parse(chapter.text)}</section>`;
}

const { chapters } = loadManual();
const copies = await lighterCopies([...new Set(chapters.flatMap((c) => c.images.map((img) => join(MANUAL_DIR, img.src))))]);
const toc = chapters
  .map((c, i) => {
    const hs = headingsOf(c.text);
    const title = hs.find((h) => h.level === 1)?.title ?? c.file;
    const subs = hs.filter((h) => h.level === 2).map((h) => `<li><a href="#${chapterId(c.file)}-${h.id}">${escapeHtml(h.title)}</a></li>`).join('');
    return `<li><a class="toc-chapter" href="#${chapterId(c.file)}"><span>${i + 1}.</span> ${escapeHtml(title)}</a><ul>${subs}</ul></li>`;
  })
  .join('\n');
const generatedAt = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${TITLE}</title>
<style>
  @page { size: A4; margin: 22mm 18mm 20mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1e293b; margin: 0; }
  h1, h2, h3, h4 { color: #2f5a1e; line-height: 1.25; break-after: avoid; }
  h1 { font-size: 22pt; margin: 0 0 14pt; padding-bottom: 8pt; border-bottom: 2pt solid #72af54; }
  h1 .chapter-number { display: block; font-size: 10pt; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #64748b; margin-bottom: 4pt; }
  h2 { font-size: 15pt; margin: 20pt 0 8pt; }
  h3 { font-size: 12pt; margin: 16pt 0 6pt; color: #334155; }
  h4 { font-size: 10.5pt; margin: 12pt 0 4pt; color: #334155; }
  p { margin: 0 0 8pt; orphans: 3; widows: 3; }
  a { color: #2f5a1e; text-decoration: none; }
  ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
  li { margin-bottom: 3pt; }
  li > p { margin-bottom: 4pt; }
  code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 9pt; background: #f1f5f9; padding: 1pt 3pt; border-radius: 3pt; }
  blockquote { margin: 10pt 0; padding: 8pt 12pt; border-left: 3pt solid #f59e0b; background: #fffbeb; break-inside: avoid; }
  blockquote p:last-child { margin-bottom: 0; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt; font-size: 9.5pt; break-inside: avoid; }
  th, td { border: .5pt solid #cbd5e1; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; }
  figure { margin: 10pt 0 14pt; text-align: center; break-inside: avoid; }
  figure img { max-width: 100%; max-height: 215mm; object-fit: contain; border: .5pt solid #cbd5e1; border-radius: 3pt; }
  figcaption { font-size: 8.5pt; color: #64748b; margin-top: 4pt; }
  hr { border: 0; border-top: .5pt solid #cbd5e1; margin: 14pt 0; }
  .chapter { break-before: page; }
  .cover { height: 245mm; display: flex; flex-direction: column; justify-content: center; }
  .cover .brand { font-size: 34pt; font-weight: 700; color: #2f5a1e; }
  .cover .title { font-size: 20pt; margin-top: 6pt; color: #334155; }
  .cover .subtitle { font-size: 12pt; margin-top: 14pt; color: #64748b; max-width: 130mm; }
  .cover .notice { margin-top: 40mm; padding: 10pt 14pt; border-left: 3pt solid #f59e0b; background: #fffbeb; font-size: 10pt; max-width: 150mm; }
  .cover .meta { margin-top: 14pt; font-size: 9pt; color: #64748b; }
  .toc { break-before: page; }
  .toc ol { list-style: none; padding: 0; }
  .toc > ol > li { margin-bottom: 9pt; }
  .toc .toc-chapter { font-weight: 600; font-size: 11.5pt; }
  .toc ul { list-style: none; padding-left: 16pt; margin: 3pt 0 0; font-size: 9.5pt; columns: 2; column-gap: 16pt; }
  .toc ul a { color: #475569; }
</style></head>
<body>
  <div class="cover">
    <div class="brand">FertilizaCerrado</div>
    <div class="title">Manual do usuário</div>
    <div class="subtitle">${SUBTITLE}</div>
    <div class="notice"><strong>Aviso.</strong> O FertilizaCerrado é uma ferramenta de apoio: ${DISCLAIMER}. As estimativas do painel agrometeorológico dependem dos dados climáticos e dos parâmetros informados.</div>
    <div class="meta">Gerado em ${generatedAt} a partir de docs/manual.</div>
  </div>
  <div class="toc" id="sumario"><h1>Sumário</h1><ol>${toc}</ol></div>
  ${chapters.map((c, i) => renderChapter(c, i + 1)).join('\n')}
</body></html>`;

const workDir = join(ROOT, 'frontend', 'test-results', 'manual');
mkdirSync(workDir, { recursive: true });
const htmlPath = join(workDir, 'manual.html');
writeFileSync(htmlPath, html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  const broken = await page.evaluate(() => Array.from(document.images).filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src));
  if (broken.length > 0) throw new Error(`imagens que não carregaram: ${broken.join(', ')}`);
  const footer = (inner) => `<div style="width:100%; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:7.5pt; color:#64748b; padding:0 18mm; display:flex; justify-content:space-between;">${inner}</div>`;
  const out = join(MANUAL_DIR, PDF_NAME);
  await page.pdf({
    path: out,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: footer(`<span>${TITLE}</span><span></span>`),
    footerTemplate: footer('<span>O sistema apoia e não substitui a decisão do responsável técnico.</span><span>página <span class="pageNumber"></span> de <span class="totalPages"></span></span>'),
    outline: true,
    tagged: true,
  });
  console.log(`Imagens convertidas para JPEG dentro do PDF: ${copies.size} (${[...copies.keys()].map((f) => basename(f, '.png').slice(0, 5)).join(', ')})`);
  console.log(`PDF gerado: docs/manual/${PDF_NAME} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB, ${chapters.length} capítulos, imagens de ${IMG_DIR.replace(`${ROOT}/`, '')})`);
} finally {
  await browser.close();
}
