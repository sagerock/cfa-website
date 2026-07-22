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

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    date: z.string(),
    excerpt: z.string().optional(),
    cover: z.string().optional(),
  }),
});

export const collections = { spine, posts };
