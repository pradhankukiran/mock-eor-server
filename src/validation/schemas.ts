import { z } from 'zod';

export const contractInputSchema = z.object({
  country: z.string().min(2),
  salary: z.number().positive(),
  currency: z.string().min(3).max(3),
  role: z.string().min(2),
  start_date: z.string().min(4),
  benefits: z.array(z.string()).default([]),
});


