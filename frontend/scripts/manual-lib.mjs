/**
 * Leitura e verificação do manual do usuário (docs/manual). Usado por
 * manual-check.mjs (consistência, ao fim da captura) e manual-pdf.mjs (PDF).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MANUAL_DIR = join(ROOT, 'docs', 'manual');
export const IMG_DIR = join(MANUAL_DIR, 'img');
export const PDF_NAME = 'manual-completo.pdf';
export const CAPTURE_JSON = join(IMG_DIR, 'captura.json');
export const DISCLAIMER = 'não substitui a decisão do responsável técnico';

export const CHAPTERS = [
  '01-primeiros-passos.md',
  '02-propriedades.md',
  '03-talhoes.md',
  '04-cultivares.md',
  '05-safras.md',
  '06-painel-agrometeorologico.md',
  '07-administracao.md',
  '08-perguntas-e-glossario.md',
];

/** Âncora de título como o GitHub gera: minúsculas, sem pontuação, espaços viram hífens. */
export function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

const withoutCode = (text) => text.replace(/```[\s\S]*?```/g, '');

export function headingsOf(text) {
  const seen = new Map();
  return [...withoutCode(text).matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)].map((m) => {
    const base = slug(m[2]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { level: m[1].length, title: m[2].replace(/[`*]/g, ''), id: n === 0 ? base : `${base}-${n}` };
  });
}

export const imagesOf = (text) => [...text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map((m) => ({ alt: m[1], src: m[2] }));
export const linksOf = (text) => [...withoutCode(text).matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g)].map((m) => ({ label: m[1], href: m[2] }));

export function loadManual() {
  const read = (file) => (existsSync(join(MANUAL_DIR, file)) ? readFileSync(join(MANUAL_DIR, file), 'utf8') : null);
  const files = ['README.md', ...CHAPTERS].map((file) => {
    const text = read(file);
    return { file, text, headings: text ? headingsOf(text) : [], images: text ? imagesOf(text) : [], links: text ? linksOf(text) : [] };
  });
  return { readme: files[0], chapters: files.slice(1), files };
}

const formatBr = (value, decimals) => Number(value).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** `phases.F3.ksMean`: em listas, o segmento escolhe o item pela chave `phase`. */
function resolvePath(obj, path) {
  return path.split('.').reduce((cur, seg) => {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) return cur.find((item) => item && item.phase === seg) ?? cur[Number(seg)];
    return cur[seg];
  }, obj);
}

/** Valor numérico de uma entrada do captura.json: número, ou texto como aparece na tela ("73,6 %", "47,8 sc/ha"). */
function numericOf(value) {
  if (typeof value !== 'string') return Number(value);
  const m = value.match(/-?\d[\d.]*(?:,\d+)?/);
  return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : NaN;
}

/**
 * Valores do capítulo 6 marcados no markdown como `0,85<!-- valor:phases.F3.ksMean|2 -->`
 * ou `53,1<!-- valor:yield.predicted|1 -->` (caminho no captura.json e casas decimais)
 * têm de coincidir com a última captura. A entrada pode ser número ou o texto da tela.
 */
export function checkValues(text, capture, file) {
  const errors = [];
  let count = 0;
  for (const m of text.matchAll(/(-?\d[\d.]*(?:,\d+)?)\s*(?:%|\*\*|`|\s)*<!--\s*valor:([\w.]+)(?:\|(\d+))?\s*-->/g)) {
    count++;
    const [, written, path, dec] = m;
    const actual = numericOf(resolvePath(capture, path));
    if (Number.isNaN(actual)) {
      errors.push(`${file}: marcador valor:${path} não existe no captura.json`);
      continue;
    }
    const expected = formatBr(actual, Number(dec ?? 2));
    if (written !== expected) errors.push(`${file}: valor:${path} está "${written}" no texto, mas a captura registrou "${expected}"`);
  }
  if (/<!--\s*valor:/.test(text) && count !== [...text.matchAll(/<!--\s*valor:/g)].length) {
    errors.push(`${file}: há marcador <!-- valor:… --> sem um número imediatamente antes`);
  }
  return errors;
}

/** Devolve a lista de problemas (vazia = manual consistente). */
export function checkManual() {
  const errors = [];
  const { readme, chapters, files } = loadManual();
  for (const f of files) if (f.text == null) errors.push(`arquivo ausente: docs/manual/${f.file}`);
  if (errors.length) return errors;

  const anchors = new Map(files.map((f) => [f.file, new Set(f.headings.map((h) => h.id))]));
  const referenced = new Set();
  for (const f of files) {
    for (const img of f.images) {
      if (!img.src.startsWith('img/')) errors.push(`${f.file}: imagem fora de img/: ${img.src}`);
      else if (!existsSync(join(MANUAL_DIR, img.src))) errors.push(`${f.file}: imagem ausente: ${img.src}`);
      referenced.add(img.src.replace(/^img\//, ''));
      if (!img.alt.trim()) errors.push(`${f.file}: imagem sem legenda: ${img.src}`);
    }
    for (const link of f.links) {
      if (/^(https?:|mailto:)/.test(link.href)) continue;
      const [target, hash] = link.href.split('#');
      if (target === '' || anchors.has(target)) {
        const set = anchors.get(target === '' ? f.file : target);
        if (hash && !set.has(decodeURIComponent(hash))) errors.push(`${f.file}: âncora inexistente: ${link.href}`);
      } else if (target !== PDF_NAME && !existsSync(join(MANUAL_DIR, target))) { // o PDF é gerado depois desta verificação
        errors.push(`${f.file}: link quebrado: ${link.href}`);
      }
    }
  }
  if (existsSync(IMG_DIR)) {
    for (const png of readdirSync(IMG_DIR).filter((n) => n.endsWith('.png'))) {
      if (!referenced.has(png)) errors.push(`imagem órfã (não usada em nenhum capítulo): img/${png}`);
    }
  }
  for (const c of CHAPTERS) if (!readme.links.some((l) => l.href.split('#')[0] === c)) errors.push(`README.md: falta o link para ${c}`);
  if (!readme.links.some((l) => l.href === PDF_NAME)) errors.push(`README.md: falta o link para ${PDF_NAME}`);
  if (!readme.text.includes(DISCLAIMER)) errors.push('README.md: falta o aviso de responsabilidade técnica');
  const ch6 = chapters[5];
  if ([...ch6.text.matchAll(new RegExp(DISCLAIMER, 'g'))].length < 2) errors.push(`${ch6.file}: o aviso de responsabilidade técnica deve aparecer na abertura e na seção Produtividade`);

  if (!existsSync(CAPTURE_JSON)) errors.push('img/captura.json ausente: rode `pnpm manual:capture`');
  else {
    const capture = JSON.parse(readFileSync(CAPTURE_JSON, 'utf8'));
    const marked = checkValues(ch6.text, capture, ch6.file);
    errors.push(...marked);
    for (const key of ['yield.ym', 'yield.yieldIndexPct', 'yield.predicted']) {
      if (!new RegExp(`<!--\\s*valor:${key.replace('.', '\\.')}`).test(ch6.text)) errors.push(`${ch6.file}: a seção Produtividade precisa marcar ${key} com <!-- valor:${key} -->`);
    }
  }
  return errors;
}
