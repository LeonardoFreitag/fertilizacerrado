/**
 * Grade regular do ERA5-Land: 0,1° × 0,1°, com nós em múltiplos exatos de
 * 0,1° em latitude e longitude.
 */
export const ERA5_GRID_STEP = 0.1;

export interface Era5GridCell {
  lat: number;
  lon: number;
}

/**
 * Nó da grade mais próximo do ponto. Em cada eixo o valor é arredondado para
 * o múltiplo de 0,1° mais próximo; em empate exato (x,x5) vale o Math.round
 * (meio para cima), escolha arbitrária mas determinística.
 */
export function snapToEra5Cell(lat: number, lon: number): Era5GridCell {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError(`latitude inválida: ${lat}`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new RangeError(`longitude inválida: ${lon}`);
  }

  return { lat: snap(lat), lon: normalizeLon(snap(lon)) };
}

// Arredonda em inteiros (décimos de grau) para evitar resíduos de ponto flutuante.
// O toFixed(6) antes do round garante que 16.65 × 10 (= 166.49999999999997 em
// binário) seja tratado como o empate exato 166.5.
function snap(value: number): number {
  const tenths = Math.round(Number((value / ERA5_GRID_STEP).toFixed(6)));
  const snapped = Number((tenths * ERA5_GRID_STEP).toFixed(1));
  return snapped === 0 ? 0 : snapped; // normaliza -0
}

// 180 e -180 são o mesmo meridiano; a grade usa -180.
function normalizeLon(lon: number): number {
  return lon === 180 ? -180 : lon;
}
