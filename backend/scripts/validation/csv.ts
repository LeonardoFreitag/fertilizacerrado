// Leitura mínima de CSV para os scripts de validação: vírgula, ponto decimal,
// sem aspas (suficiente para exportações do CROPWAT em inglês).

export type CsvRow = Record<string, string>;

export class InputError extends Error {}

export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) throw new InputError('CSV precisa de cabeçalho e ao menos uma linha');
  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row: CsvRow = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? '';
    });
    return row;
  });
  return { header, rows };
}

export function optionalNumber(row: CsvRow, key: string): number | undefined {
  const raw = row[key];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new InputError(`valor não numérico em "${key}": ${raw}`);
  return value;
}

export function requiredNumber(row: CsvRow, key: string, line: number): number {
  const value = optionalNumber(row, key);
  if (value === undefined) throw new InputError(`linha ${line}: coluna "${key}" ausente`);
  return value;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const fmt = (v: string | number | null | undefined) =>
    v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : v;
  return [header.join(','), ...rows.map((r) => r.map(fmt).join(','))].join('\n') + '\n';
}
