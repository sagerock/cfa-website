// Applies the staged donations migration to an isolated in-memory PGlite
// database; it never contacts Supabase. Skips unless PGLITE_MODULE points at an
// installed @electric-sql/pglite entry (see docs/donation-preview.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modulePath = process.env.PGLITE_MODULE;
const CLIENT = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd';
const KEY = '00000000-0000-4000-8000-0000000000aa';

test('donations table: access boundary, amount constraints, check-received path', { skip: !modulePath }, async () => {
  const { PGlite } = await import(modulePath);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create table public.clients(id uuid primary key);
      insert into public.clients values ('${CLIENT}');
      create function public.update_updated_at_column() returns trigger language plpgsql as $$
        begin new.updated_at = now(); return new; end $$;
    `);
    await db.exec(await readFile(
      new URL('../supabase/migrations/20260925200000_unified_donations.sql', import.meta.url),
      'utf8',
    ));

    const insert = (overrides = {}) => {
      const row = {
        client_id: CLIENT, idempotency_key: KEY, status: 'processing', fund: 'general-support',
        frequency: 'once', months: 1, method: 'card', gift_cents: 10000, fee_covered_cents: 300,
        total_cents: 10300, schedule_total_cents: 10300, first_name: 'Test', last_name: 'Donor',
        email: 'donor@example.org', ...overrides,
      };
      const keys = Object.keys(row);
      return db.query(
        `insert into public.donations(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
        keys.map((key) => row[key]),
      );
    };

    await db.exec('set role service_role');
    const card = (await insert()).rows[0];
    assert.equal(card.status, 'processing');
    await assert.rejects(() => insert(), /duplicate key/, 'same idempotency key twice');
    const key = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
    await assert.rejects(() => insert({ idempotency_key: key(1), total_cents: 1, schedule_total_cents: 1 }), /gift_plus_fee/);
    await assert.rejects(() => insert({ idempotency_key: key(2), frequency: 'monthly', months: 6 }), /schedule_total/);
    await insert({ idempotency_key: key(3), frequency: 'monthly', months: 6, schedule_total_cents: 61800 });
    await assert.rejects(() => insert({ idempotency_key: key(4), frequency: 'monthly', months: 5, schedule_total_cents: 51500 }), /months_check/);
    await assert.rejects(() => insert({ idempotency_key: key(5), method: 'check', status: 'pledged' }), /check_has_no_fee/);
    await assert.rejects(() => insert({ idempotency_key: key(6), status: 'pledged' }), /card_statuses/);
    await assert.rejects(() => insert({ idempotency_key: null }), /web_needs_key/);

    const pledge = (await insert({
      idempotency_key: key(7), method: 'check', status: 'pledged', fee_covered_cents: 0,
      total_cents: 10000, schedule_total_cents: 10000,
    })).rows[0];
    const mark = (id, number, amount, donor = null) => db.query(
      'select * from public.cfa_mark_donation_check_received($1,$2,$3,$4,$5,$6)',
      [CLIENT, id, number, '2026-09-20', amount, donor],
    );
    const received = (await mark(pledge.id, '1042', 9500)).rows[0];
    assert.equal(received.status, 'check_received');
    assert.equal(received.check_amount_cents, 9500);
    assert.equal((await mark(pledge.id, '1042', 9500)).rows[0].id, pledge.id, 'same check again is a no-op');
    await assert.rejects(() => mark(pledge.id, '9999', 9500), /already recorded/);
    await assert.rejects(() => mark(card.id, '1', 100), /not a check pledge/);
    await assert.rejects(() => mark(pledge.id, '1', 0), /positive/);

    const mailed = (await mark(null, '77', 25000, JSON.stringify({
      first_name: 'Mailed', last_name: 'Check', email: 'MAILED@example.org', fund: 'kairos-scholarships',
    }))).rows[0];
    assert.equal(mailed.source, 'staff');
    assert.equal(mailed.email, 'mailed@example.org');
    assert.equal(mailed.fund, 'kairos-scholarships');
    await assert.rejects(() => mark(null, '78', 100, JSON.stringify({ first_name: 'x' })), /required/);

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(() => db.query('select * from public.donations'), /permission denied/);
      await assert.rejects(() => insert({ idempotency_key: key(9) }), /permission denied/);
      await assert.rejects(() => mark(pledge.id, '1042', 9500), /permission denied/);
    }
  } finally {
    await db.close();
  }
});
