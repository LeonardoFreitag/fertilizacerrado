import { z } from 'zod';
import { QUEUE_NAMES } from '../../../config/queue';
import { calendarDateSchema } from '../../harvests/dtos/create-harvest.dto';

export const jobParamsSchema = z.object({
  queue: z.enum(QUEUE_NAMES as [string, ...string[]]),
  id: z.string().min(1).max(200),
});

/** bbox na ordem do CDS: [N, W, S, E]. */
export const backfillRegionSchema = z
  .object({
    bbox: z.tuple([
      z.number().min(-90).max(90),
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
      z.number().min(-180).max(180),
    ]),
    from: calendarDateSchema,
    to: calendarDateSchema,
  })
  .superRefine((v, ctx) => {
    const [n, w, s, e] = v.bbox;
    if (n <= s) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bbox'], message: 'N deve ser maior que S' });
    if (e <= w) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bbox'], message: 'E deve ser maior que W' });
    if (v.from > v.to) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'to deve ser ≥ from' });
  });

export type BackfillRegionDto = z.infer<typeof backfillRegionSchema>;
