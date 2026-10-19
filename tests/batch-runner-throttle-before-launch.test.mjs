// A rate limit recorded while batch-runner.sh waits for a free slot must hold
// the next offer back.
//
// This is the race behind the occasional [2,1,1] in
// batch-runner-default-parallel.test.mjs: the wait loop checked for the
// throttle before its sleep and not after, so a 429 recorded during that sleep
// still let the next offer start at PARALLEL=3. Waiting for that under load is
// a coin toss, so this test places it: in a copy of the runner, the throttle is
// recorded just before the loop's sleep, once a slot has freed, and every
// launch logs PARALLEL and whether the throttle exists. The anchors are
// checked, so a reshaped loop fails here instead of passing without the hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SRC, runBatch } from './helpers/batch-runner-fixture.mjs';

test('a rate limit recorded while the runner waits for a slot holds the next offer back', () => {
  const sleepAnchor = '        sleep 1\n      done';
  const launchAnchor = '      process_offer "${pending_ids[$i]}" "${pending_urls[$i]}" "${pending_sources[$i]}" "${pending_notes[$i]}" &';
  assert.equal(SRC.split(sleepAnchor).length, 2, "the wait loop's sleep is not where this test expects it");
  assert.equal(SRC.split(launchAnchor).length, 2, 'the worker launch is not where this test expects it');
  const src = SRC
    .replace(sleepAnchor, '        if (( running < 3 )) && [[ ! -f "$THROTTLE_FILE" ]]; then : > "$THROTTLE_FILE"; fi\n' + sleepAnchor)
    .replace(launchAnchor, '      echo "${pending_ids[$i]} $PARALLEL $([[ -f "$THROTTLE_FILE" ]] && echo throttled || echo free)" >> "$FIXTURE_DIR/launches.log"\n' + launchAnchor);
  // No 429 from the fake CLI: the hook is the only source of the throttle.
  // Four offers: three fill the slots, and the fourth is the launch in question.
  const { stdout, launches } = runBatch({ offers: 4, src, rateLimitFirst: false });
  // The launch log first: it names the defect, where the stdout line below
  // would only say that the drop to one worker was never announced.
  const late = launches.filter((l) => / throttled$/.test(l) && !/ 1 throttled$/.test(l));
  assert.deepEqual(late, [], `offers started at PARALLEL > 1 after the throttle was recorded (launch log: ${launches.join('; ')})`);
  assert.ok(launches.some((l) => / 1 throttled$/.test(l)), `no offer started after the throttle (launch log: ${launches.join('; ')})`);
  assert.match(stdout, /Rate limited: running the remaining offers on 1 worker/);
});
