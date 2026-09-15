import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skipReason = !supabaseUrl || !serviceRoleKey
  ? 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests'
  : false;

const cases = [
  'agent_create_issue is idempotent',
  'concurrent agent_claim_issue calls have one winner',
  'agent_release_issue rejects the wrong actor',
  'an expired lease is claimable by another actor',
  'agent_link keeps gmail_thread ownership global',
  'agent_recent_actor_activity honors the requested window',
];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('agent issue store integration', async (t) => {
  if (skipReason) {
    for (const name of cases) {
      await t.test(name, { skip: skipReason }, () => {});
    }
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = randomUUID().replaceAll('-', '');
  const actorA = `test:${runId}:actor-a`;
  const actorB = `test:${runId}:actor-b`;
  let clientId;
  let primaryIssueId;
  let claimWinner;

  const rpc = async (name, parameters) => {
    const { data, error } = await supabase.rpc(name, parameters);
    assert.equal(error, null, `${name} failed: ${error?.message ?? 'unknown error'}`);
    return data;
  };

  const createIssue = (suffix, actor = actorA) => rpc('agent_create_issue', {
    p_client: clientId,
    p_key: `test-${runId}-${suffix}`,
    p_title: `Agent issue store test ${suffix}`,
    p_summary: 'Throwaway integration-test issue.',
    p_actor: actor,
    p_links: [],
  });

  try {
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        name: `Agent issue store test ${runId}`,
        sendgrid_api_key: `not-configured-${runId}`,
      })
      .select('id')
      .single();

    assert.equal(clientError, null, `throwaway client creation failed: ${clientError?.message ?? 'unknown error'}`);
    clientId = client.id;

    await t.test(cases[0], async () => {
      const first = await createIssue('idempotent');
      const second = await createIssue('idempotent');

      assert.equal(second.id, first.id);
      primaryIssueId = first.id;
    });

    await t.test(cases[1], async () => {
      const [first, second] = await Promise.all([
        rpc('agent_claim_issue', {
          p_issue: primaryIssueId,
          p_actor: actorA,
          p_ttl: '45 minutes',
        }),
        rpc('agent_claim_issue', {
          p_issue: primaryIssueId,
          p_actor: actorB,
          p_ttl: '45 minutes',
        }),
      ]);
      const successes = [first, second].filter((result) => result.ok === true);
      const failures = [first, second].filter((result) => result.ok === false);

      assert.equal(successes.length, 1);
      assert.equal(failures.length, 1);
      claimWinner = successes[0].issue.claimed_by;
      assert.ok([actorA, actorB].includes(claimWinner));
      assert.equal(failures[0].claimed_by, claimWinner);
    });

    await t.test(cases[2], async () => {
      const wrongActor = claimWinner === actorA ? actorB : actorA;
      const released = await rpc('agent_release_issue', {
        p_issue: primaryIssueId,
        p_actor: wrongActor,
      });

      assert.equal(released, false);

      const { data: issue, error } = await supabase
        .from('agent_issues')
        .select('claimed_by, claim_expires_at')
        .eq('id', primaryIssueId)
        .single();

      assert.equal(error, null, `claim verification failed: ${error?.message ?? 'unknown error'}`);
      assert.equal(issue.claimed_by, claimWinner);
      assert.notEqual(issue.claim_expires_at, null);
    });

    await t.test(cases[3], async () => {
      const released = await rpc('agent_release_issue', {
        p_issue: primaryIssueId,
        p_actor: claimWinner,
      });
      assert.equal(released, true);

      const expiringActor = `test:${runId}:expiring`;
      const nextActor = `test:${runId}:after-expiry`;
      const initialClaim = await rpc('agent_claim_issue', {
        p_issue: primaryIssueId,
        p_actor: expiringActor,
        p_ttl: '1 second',
      });
      assert.equal(initialClaim.ok, true);

      await delay(1500);

      const nextClaim = await rpc('agent_claim_issue', {
        p_issue: primaryIssueId,
        p_actor: nextActor,
        p_ttl: '45 minutes',
      });
      assert.equal(nextClaim.ok, true);
      assert.equal(nextClaim.issue.claimed_by, nextActor);
    });

    await t.test(cases[4], async () => {
      const firstIssue = await createIssue('thread-owner');
      const secondIssue = await createIssue('thread-contender');
      const threadRef = runId.slice(0, 16);
      const linkParameters = {
        p_issue: firstIssue.id,
        p_kind: 'gmail_thread',
        p_ref: threadRef,
        p_actor: actorA,
        p_note: 'Integration test thread',
      };

      await rpc('agent_link', linkParameters);
      await rpc('agent_link', linkParameters);

      const { count: linkCount, error: linkCountError } = await supabase
        .from('agent_issue_links')
        .select('*', { count: 'exact', head: true })
        .eq('issue_id', firstIssue.id)
        .eq('kind', 'gmail_thread')
        .eq('ref', threadRef);
      assert.equal(linkCountError, null, `link count failed: ${linkCountError?.message ?? 'unknown error'}`);
      assert.equal(linkCount, 1);

      const { count: eventCount, error: eventCountError } = await supabase
        .from('agent_issue_events')
        .select('*', { count: 'exact', head: true })
        .eq('issue_id', firstIssue.id)
        .eq('kind', 'linked');
      assert.equal(eventCountError, null, `event count failed: ${eventCountError?.message ?? 'unknown error'}`);
      assert.equal(eventCount, 1);

      const { error: moveError } = await supabase.rpc('agent_link', {
        ...linkParameters,
        p_issue: secondIssue.id,
        p_actor: actorB,
      });
      assert.notEqual(moveError, null);
      assert.match(moveError.message, /already linked to issue/);

      const { data: storedLink, error: storedLinkError } = await supabase
        .from('agent_issue_links')
        .select('issue_id')
        .eq('kind', 'gmail_thread')
        .eq('ref', threadRef)
        .single();
      assert.equal(storedLinkError, null, `stored link lookup failed: ${storedLinkError?.message ?? 'unknown error'}`);
      assert.equal(storedLink.issue_id, firstIssue.id);
    });

    await t.test(cases[5], async () => {
      const issue = await createIssue('recent-activity');
      const activityActor = `test:${runId}:recent`;
      const claim = await rpc('agent_claim_issue', {
        p_issue: issue.id,
        p_actor: activityActor,
        p_ttl: '45 minutes',
      });
      assert.equal(claim.ok, true);

      const withinWindow = await rpc('agent_recent_actor_activity', {
        p_issue: issue.id,
        p_within: '5 seconds',
      });
      assert.ok(withinWindow.includes(activityActor));

      await delay(1500);

      const outsideWindow = await rpc('agent_recent_actor_activity', {
        p_issue: issue.id,
        p_within: '1 second',
      });
      assert.ok(!outsideWindow.includes(activityActor));
    });
  } finally {
    if (clientId) {
      const { error } = await supabase.from('clients').delete().eq('id', clientId);
      if (error) throw new Error(`throwaway client cleanup failed: ${error.message}`);
    }
  }
});
