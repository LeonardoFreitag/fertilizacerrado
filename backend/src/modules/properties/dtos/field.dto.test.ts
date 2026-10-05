import { describe, expect, it } from 'vitest';
import { createFieldSchema } from './create-field.dto';
import { updateFieldSchema } from './update-field.dto';

const square = {
  type: 'Polygon',
  coordinates: [[[-49.3, -16.7], [-49.29, -16.7], [-49.29, -16.69], [-49.3, -16.69], [-49.3, -16.7]]],
};
const valid = { name: 'T1', geometry: square };

function fields(result: { success: boolean; error?: { flatten(): { fieldErrors: Record<string, unknown> } } }) {
  return result.success ? [] : Object.keys(result.error!.flatten().fieldErrors).sort();
}

describe('createFieldSchema — altitude e solo', () => {
  it('aceita os três campos e os omite sem erro', () => {
    expect(createFieldSchema.safeParse(valid).success).toBe(true);
    const r = createFieldSchema.parse({ ...valid, altitudeM: 741, thetaFC: 0.3, thetaWP: 0.14 });
    expect([r.altitudeM, r.thetaFC, r.thetaWP]).toEqual([741, 0.3, 0.14]);
  });

  it('rejeita teores invertidos apontando thetaFC', () => {
    expect(fields(createFieldSchema.safeParse({ ...valid, thetaFC: 0.12, thetaWP: 0.28 }))).toEqual(['thetaFC']);
    expect(fields(createFieldSchema.safeParse({ ...valid, thetaFC: 0.2, thetaWP: 0.2 }))).toEqual(['thetaFC']);
  });

  it('rejeita faixas inválidas', () => {
    expect(fields(createFieldSchema.safeParse({ ...valid, altitudeM: 6000 }))).toEqual(['altitudeM']);
    expect(fields(createFieldSchema.safeParse({ ...valid, altitudeM: -200 }))).toEqual(['altitudeM']);
    expect(fields(createFieldSchema.safeParse({ ...valid, thetaFC: 1 }))).toEqual(['thetaFC']);
    expect(fields(createFieldSchema.safeParse({ ...valid, thetaWP: 0 }))).toEqual(['thetaWP']);
  });
});

describe('updateFieldSchema — altitude e solo', () => {
  it('aceita anular os campos', () => {
    expect(updateFieldSchema.parse({ altitudeM: null, thetaFC: null, thetaWP: null })).toEqual({ altitudeM: null, thetaFC: null, thetaWP: null });
  });

  it('não valida a relação entre os teores (fica para o service, sobre o estado resultante)', () => {
    expect(updateFieldSchema.safeParse({ thetaWP: 0.3 }).success).toBe(true);
  });
});
