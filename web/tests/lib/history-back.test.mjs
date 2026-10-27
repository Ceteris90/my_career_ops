import assert from "node:assert/strict";
import { test } from "node:test";
import { returnsToPrevious } from "../../src/lib/history-back.mjs";

const current = "http://localhost:3000/pipeline/60?tab=ALL&sort=tracker&dir=1";
const list = "http://localhost:3000/pipeline?tab=ALL&sort=tracker&dir=1";

test("a back link to the exact previous entry returns to it", () => {
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=tracker&dir=1", current, list), true);
});

test("query parameter order does not matter", () => {
  assert.equal(returnsToPrevious("/pipeline?dir=1&sort=tracker&tab=ALL", current, list), true);
});

test("a different parameter value is a new navigation", () => {
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=company&dir=1", current, list), false);
});

test("a parameter the previous entry lacks is a new navigation", () => {
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=tracker&dir=1&q=Fixture", current, list), false);
});

test("a different pathname is a new navigation", () => {
  assert.equal(returnsToPrevious("/explore?tab=ALL&sort=tracker&dir=1", current, list), false);
});

test("with no previous entry the link navigates normally", () => {
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=tracker&dir=1", current, undefined), false);
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=tracker&dir=1", current, null), false);
});

test("a previous entry on another origin is never returned to", () => {
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=tracker&dir=1", current, "https://elsewhere.example/pipeline?tab=ALL&sort=tracker&dir=1"), false);
});
