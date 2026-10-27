// A one-job paste used to read as "thin" because it was under 80 words, and
// the first-run checklist opened on twelve evaluation sections. A named role
// is enough to match. Compact first-run counts the four setup files.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cvReadiness } from "../../src/lib/cv/quality.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const ONE_JOB = [
  "## Experience",
  "Floor lead, Northwind Market",
  "2019-2024",
  "Opened the shop and wrote the weekly schedule.",
].join("\n");

test("a one-job paste with a role is ready to match", () => {
  const ready = cvReadiness(ONE_JOB);
  assert.ok(ready.words < 80, `expected a short paste, got ${ready.words} words`);
  assert.equal(ready.hasExperience, true);
  assert.equal(ready.scoreable, true);
  assert.equal(ready.hint, undefined);
});

test("a title with no role stays thin", () => {
  const thin = cvReadiness("Floor lead at a grocery chain");
  assert.equal(thin.hasExperience, false);
  assert.equal(thin.scoreable, false);
});

test("a short skills list with no role stays thin", () => {
  const skills = cvReadiness("## Skills\nScheduling, inventory, opening, closing");
  assert.equal(skills.hasSkills, true);
  assert.equal(skills.hasExperience, false);
  assert.ok(skills.words < 80);
  assert.equal(skills.scoreable, false);
});

test("compact first-run checklist is the four setup files", () => {
  const src = readFileSync(join(root, "src/components/home/onboarding-progress.tsx"), "utf8");
  assert.match(src, /const showSections = !compact/);
  assert.match(src, /showSections && generic\.length/);
  assert.match(src, /\{showSections && \(/);
  assert.match(src, /what evaluations score against/);
  const home = readFileSync(join(root, "src/components/home/first-run-home.tsx"), "utf8");
  assert.match(home, /<OnboardingProgress compact/);
});
