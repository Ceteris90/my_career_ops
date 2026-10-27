import { test } from "node:test";
import assert from "node:assert/strict";
import { homeLead } from "../../src/lib/home/home-lead.mjs";

test("tracked work leads Today, ahead of setup", () => {
  assert.equal(homeLead(true), "queue");
});

test("an install with nothing tracked still leads with setup", () => {
  assert.equal(homeLead(false), "setup");
});
