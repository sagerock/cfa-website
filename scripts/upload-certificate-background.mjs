import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const [source, destination = 'templates/cfa-classic-v1.jpg'] = process.argv.slice(2);
if (!source) throw new Error('Usage: node scripts/upload-certificate-background.mjs <private.jpg|png> [storage-path]');
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
if (!/\.(jpe?g|png)$/i.test(source)) throw new Error('Background must be JPEG or PNG');
if (!/^templates\/[a-z0-9._/-]+$/i.test(destination) || destination.includes('..')) {
  throw new Error('Destination must be a safe path below templates/');
}

const bytes = await readFile(source);
if (bytes.length > 10 * 1024 * 1024) throw new Error('Background exceeds the private bucket limit (10 MB)');
const contentType = /\.png$/i.test(source) ? 'image/png' : 'image/jpeg';
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error } = await admin.storage.from('cfa-certificate-assets').upload(destination, bytes, {
  contentType,
  cacheControl: '0',
  upsert: true,
});
if (error) throw error;
console.log(`Uploaded ${basename(source)} to private certificate asset ${destination}`);
