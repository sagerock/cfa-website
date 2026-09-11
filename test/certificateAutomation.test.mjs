import assert from 'node:assert/strict';
import test from 'node:test';
import * as pdfLib from 'pdf-lib';
import {
  buildCertificatePdf,
  fitTextSize,
  formatCertificateDate,
  normalizeCertificateLayout,
  validateCertificateInput,
} from '../supabase/functions/_shared/certificatePdf.js';
import {
  canIssueCertificate,
  certificateSnapshot,
  certificateStoragePath,
  createCertificateNumber,
} from '../supabase/functions/_shared/certificateRecords.js';

test('certificate dates are calendar-validated and formatted without timezone drift', () => {
  assert.equal(formatCertificateDate('2026-07-26'), 'July 26, 2026');
  assert.throws(() => formatCertificateDate('2026-02-30'), /valid calendar date/);
  assert.throws(() => formatCertificateDate('07/26/2026'), /YYYY-MM-DD/);
});

test('layout defaults survive partial or malformed template JSON', () => {
  const layout = normalizeCertificateLayout({ name_y: 420, ink: ['bad'] });
  assert.equal(layout.name_y, 420);
  assert.equal(layout.program_y, 345);
  assert.deepEqual(layout.ink, [0.12, 0.08, 0.1]);
});

test('long certificate text is fitted but never made unreadably small', () => {
  const font = { widthOfTextAtSize: (text, size) => text.length * size };
  assert.equal(fitTextSize(font, 'short', 20, 200, 11), 20);
  assert.equal(fitTextSize(font, 'a'.repeat(100), 20, 200, 11), 11);
});

test('certificate inputs reject blank identity and oversized fields', () => {
  assert.throws(() => validateCertificateInput({
    recipientName: '', programTitle: 'Program', awardDate: '2026-09-11', certificateNumber: 'PREVIEW',
  }), /recipient_name/);
  assert.throws(() => validateCertificateInput({
    recipientName: 'Learner', programTitle: 'x'.repeat(241), awardDate: '2026-09-11', certificateNumber: 'PREVIEW',
  }), /program_title/);
});

test('certificate numbers and private storage paths are predictable shapes', () => {
  assert.equal(
    createCertificateNumber(new Date('2026-09-11T12:00:00Z'), '12345678-1234-4abc-8def-123456789abc'),
    'CFA-2026-1234567812',
  );
  assert.equal(
    certificateStoragePath(
      '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ),
    '22500cd6-052a-42ff-a0cb-4f3ba9125dfd/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.pdf',
  );
});

test('issuance requires an explicit reviewed eligibility record and snapshots it', () => {
  assert.equal(canIssueCertificate(null), false);
  assert.equal(canIssueCertificate({ eligible: true, basis: 'attendance' }), false);
  const eligibility = {
    eligible: true,
    basis: 'attendance',
    attended_sessions: 10,
    countable_sessions: 12,
    attendance_ratio: 0.8333,
    evidence: { source: 'zoom' },
    reviewed_by: 'Milan',
    reviewed_at: '2027-03-01T12:00:00Z',
  };
  assert.equal(canIssueCertificate(eligibility), true);
  assert.deepEqual(certificateSnapshot(eligibility), {
    basis: 'attendance',
    attended_sessions: 10,
    countable_sessions: 12,
    attendance_ratio: 0.8333,
    evidence: { source: 'zoom' },
    reviewed_by: 'Milan',
    reviewed_at: '2027-03-01T12:00:00Z',
  });
});

test('renderer creates a one-page landscape PDF without a private background asset', async () => {
  const bytes = await buildCertificatePdf(pdfLib, {
    recipientName: 'Sample Participant',
    programTitle: 'Waldorf High School Teacher Education Program',
    detailText: 'with a Concentration in Arts & Art History.',
    awardDate: '2026-07-26',
    certificateNumber: 'CFA-2026-1234567890',
  });
  const pdf = await pdfLib.PDFDocument.load(bytes);
  const [page] = pdf.getPages();
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(page.getWidth(), 792);
  assert.equal(page.getHeight(), 612);
  assert.ok(bytes.length > 3000);
});
