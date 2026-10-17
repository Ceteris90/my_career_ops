import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyLiveness } from '../liveness-core.mjs';
import { shouldDedupScanHistoryRow } from '../scan.mjs';

const bodyText = 'Job description and responsibilities. '.repeat(12);

for (const [board, applyControl] of [
  ['Meituan', '立即申请'],
  ['CareerViet', 'NỘP ĐƠN ỨNG TUYỂN'],
  ['Tencent', '申请岗位'],
]) {
  test(`${board} live posting apply control is recognized`, () => {
    assert.deepEqual(classifyLiveness({
      status: 200,
      requestedUrl: 'https://example.com/jobs/123456',
      finalUrl: 'https://example.com/jobs/123456',
      bodyText,
      applyControls: [applyControl],
    }), {
      result: 'active',
      code: 'apply_control_visible',
      reason: 'visible apply control detected',
    });
  });
}

test('no-apply-control history rows are retried rather than deduplicated permanently', () => {
  assert.equal(shouldDedupScanHistoryRow(
    { firstSeen: '2025-09-01', status: 'skipped_no_apply_control' },
    { recheckAfterDays: 30, today: '2026-10-06' },
  ), false);
});
