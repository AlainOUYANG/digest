import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const issues = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/issues' }),
  schema: z.object({
    title: z.string().min(1),
    date: z.coerce.date(),
    issue: z.number().int().positive(),
    unavailableSources: z.array(z.string()).default([]),
  }),
});

export const collections = { issues };
