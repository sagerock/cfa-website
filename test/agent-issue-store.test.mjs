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
  'agent_escalate records human ownership and a Gmail draft',
  'agent_needs_human returns the ordered owner queue',
  'agent_issue_links_of returns Gmail draft links',
  'agent_set_owner clears ownership',
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
  let escalatedIssueId;
  let escalatedDraftRef;

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

    await t.test(cases[6], async () => {
      const issue = await createIssue('escalated');
      const claimActor = `test:${runId}:claimed-before-escalation`;
      const owner = `human:${runId}:escalation-owner`;
      const why = 'Sage should review this draft before it is sent.';
      escalatedDraftRef = `draft-${runId}`;

      const claim = await rpc('agent_claim_issue', {
        p_issue: issue.id,
        p_actor: claimActor,
        p_ttl: '45 minutes',
      });
      assert.equal(claim.ok, true);

      const escalated = await rpc('agent_escalate', {
        p_issue: issue.id,
        p_actor: actorA,
        p_why: why,
        p_owner: owner,
        p_draft: escalatedDraftRef,
      });
      escalatedIssueId = escalated.id;

      assert.equal(escalated.owner, owner);
      assert.equal(escalated.status, 'waiting');
      assert.equal(escalated.next_action, why);
      assert.equal(escalated.claimed_by, claimActor);

      const { data: draftLink, error: draftLinkError } = await supabase
        .from('agent_issue_links')
        .select('kind, ref, note')
        .eq('issue_id', issue.id)
        .eq('kind', 'gmail_draft')
        .eq('ref', escalatedDraftRef)
        .single();
      assert.equal(draftLinkError, null, `draft link lookup failed: ${draftLinkError?.message ?? 'unknown error'}`);
      assert.deepEqual(draftLink, {
        kind: 'gmail_draft',
        ref: escalatedDraftRef,
        note: why,
      });

      const { data: escalatedEvents, error: escalatedEventsError } = await supabase
        .from('agent_issue_events')
        .select('body, refs')
        .eq('issue_id', issue.id)
        .eq('kind', 'escalated');
      assert.equal(escalatedEventsError, null, `escalated event lookup failed: ${escalatedEventsError?.message ?? 'unknown error'}`);
      assert.equal(escalatedEvents.length, 1);
      assert.equal(escalatedEvents[0].body, why);
      assert.deepEqual(escalatedEvents[0].refs, {
        owner,
        gmail_draft: escalatedDraftRef,
      });
    });

    await t.test(cases[7], async () => {
      const owner = `human:${runId}:queue-owner`;
      const otherOwner = `human:${runId}:other-owner`;
      const nowIssue = await createIssue('human-now');
      const soonIssue = await createIssue('human-soon');
      const decidedIssue = await createIssue('human-decided');
      const otherOwnerIssue = await createIssue('human-other-owner');

      await rpc('agent_set_owner', {
        p_issue: nowIssue.id,
        p_actor: actorA,
        p_owner: owner,
      });
      await rpc('agent_escalate', {
        p_issue: soonIssue.id,
        p_actor: actorA,
        p_why: 'Waiting for human review.',
        p_owner: owner,
      });
      await rpc('agent_set_owner', {
        p_issue: decidedIssue.id,
        p_actor: actorA,
        p_owner: owner,
      });
      await rpc('agent_set_owner', {
        p_issue: otherOwnerIssue.id,
        p_actor: actorA,
        p_owner: otherOwner,
      });

      const { error: queueSetupError } = await supabase
        .from('agent_issues')
        .upsert([
          { ...nowIssue, owner, priority: 'now' },
          { ...soonIssue, owner, status: 'waiting', priority: 'soon' },
          { ...decidedIssue, owner, status: 'decided', priority: 'now' },
          { ...otherOwnerIssue, owner: otherOwner, priority: 'now' },
        ]);
      assert.equal(queueSetupError, null, `human queue setup failed: ${queueSetupError?.message ?? 'unknown error'}`);

      const queue = await rpc('agent_needs_human', {
        p_client: clientId,
        p_owner: owner,
      });

      assert.deepEqual(queue.map((item) => item.id), [nowIssue.id, soonIssue.id]);
      assert.deepEqual(queue.map((item) => item.priority), ['now', 'soon']);
      assert.ok(queue.every((item) => item.owner === owner));
      assert.ok(queue.every((item) => ['open', 'waiting'].includes(item.status)));
    });

    await t.test(cases[8], async () => {
      const links = await rpc('agent_issue_links_of', {
        p_issue: escalatedIssueId,
      });
      const draftLink = links.find((link) => (
        link.kind === 'gmail_draft' && link.ref === escalatedDraftRef
      ));

      assert.notEqual(draftLink, undefined);
      assert.equal(draftLink.issue_id, escalatedIssueId);
    });

    await t.test(cases[9], async () => {
      const issue = await createIssue('owner-clear');
      const owner = `human:${runId}:temporary-owner`;

      const assigned = await rpc('agent_set_owner', {
        p_issue: issue.id,
        p_actor: actorA,
        p_owner: owner,
      });
      assert.equal(assigned.owner, owner);

      const cleared = await rpc('agent_set_owner', {
        p_issue: issue.id,
        p_actor: actorB,
        p_owner: null,
      });
      assert.equal(cleared.owner, null);

      const { data: storedIssue, error: storedIssueError } = await supabase
        .from('agent_issues')
        .select('owner')
        .eq('id', issue.id)
        .single();
      assert.equal(storedIssueError, null, `cleared owner lookup failed: ${storedIssueError?.message ?? 'unknown error'}`);
      assert.equal(storedIssue.owner, null);
    });
  } finally {
    if (clientId) {
      const { error } = await supabase.from('clients').delete().eq('id', clientId);
      if (error) throw new Error(`throwaway client cleanup failed: ${error.message}`);
    }
  }
});
