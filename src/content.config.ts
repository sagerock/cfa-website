import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const spine = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/spine' }),
  schema: z.object({
    title: z.string(),
    navLabel: z.string(),
    section: z.enum(['about', 'programs', 'residency']),
    slug: z.string(),
    order: z.number(),
  }),
});

export const collections = { spine };
