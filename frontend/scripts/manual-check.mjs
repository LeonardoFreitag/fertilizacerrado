/**
 * Consistência do manual: imagens referenciadas existem, não há PNG órfão, links
 * internos resolvem e os valores do capítulo 6 batem com o captura.json.
 * Roda ao fim de `pnpm manual:capture` e antes de `pnpm manual:pdf`.
 */
import { checkManual } from './manual-lib.mjs';

const errors = checkManual();
if (errors.length > 0) {
  console.error(`Manual inconsistente (${errors.length} problema(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('Manual consistente: imagens, links e valores do capítulo 6 conferem.');
