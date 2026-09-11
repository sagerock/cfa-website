import { readFile, writeFile } from 'node:fs/promises';
import * as pdfLib from 'pdf-lib';
import { buildCertificatePdf } from '../supabase/functions/_shared/certificatePdf.js';

function args(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (!key || value == null) throw new Error('Arguments must use --name value pairs');
    parsed[key] = value;
  }
  return parsed;
}

const options = args(process.argv.slice(2));
const output = options.out || 'exports/private/certificate-preview.pdf';
const backgroundBytes = options.background ? await readFile(options.background) : null;
const bytes = await buildCertificatePdf(pdfLib, {
  recipientName: options.name || 'Sample Participant',
  programTitle: options.program || 'Waldorf High School Teacher Education Program',
  detailText: options.detail || 'with a Concentration in Arts & Art History.',
  awardDate: options.date || new Date().toISOString().slice(0, 10),
  certificateNumber: 'PREVIEW',
  backgroundBytes,
  backgroundMime: options.background?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
});
await writeFile(output, bytes);
console.log(`Wrote ${output}`);
