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
    // optional "rich program" fields (used by the program template when present)
    tagline: z.string().optional(),
    category: z.string().optional(),
    heroImage: z.string().optional(),
    facts: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    director: z.string().optional(),
    directorRole: z.string().optional(),
    directorPhoto: z.string().optional(),
    directorEmail: z.string().optional(),
    applyUrl: z.string().optional(),
    applyLabel: z.string().optional(),
    flyerUrl: z.string().optional(),
    testimonials: z.array(z.object({ quote: z.string(), who: z.string().optional() })).optional(),
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
