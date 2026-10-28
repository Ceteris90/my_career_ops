// A one-job paste used to read as "thin" because it was under 80 words, and
// the first-run checklist opened on twelve evaluation sections. A named role
// is enough to match. Compact first-run counts the four setup files.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cvReadiness } from "../../src/lib/cv/quality.ts";
import { onboardingChecklist, PREREQS } from "../../src/lib/home/onboarding-checklist.mjs";

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

test("a bare experience heading is not a role", () => {
  for (const md of ["## Experience", "## Experience\n\n## Skills\nScheduling"]) {
    const bare = cvReadiness(md);
    assert.equal(bare.scoreable, false, md);
  }
  assert.equal(cvReadiness("## Experience\nFloor lead, Northwind Market").scoreable, true);
});

test("work authorization is not a role, and a subheading under experience is", () => {
  const auth = cvReadiness("## Work Authorization\nAuthorized to work");
  assert.equal(auth.scoreable, false);
  assert.equal(auth.hasExperience, false);
  const sub = cvReadiness("## Experience\n### Floor lead, Northwind Market");
  assert.equal(sub.scoreable, true);
  assert.equal(cvReadiness("## Work Experience\nFloor lead, Northwind Market").scoreable, true);
});

const SECTIONS = [
  { heading: "## Your Target Roles", state: "filled" },
  { heading: "## Your Deal Breakers", state: "missing" },
];

test("compact first-run checklist counts the four setup files", () => {
  const compact = onboardingChecklist({ missing: ["cv.md", "modes/_profile.md", "config/profile.yml", "portals.yml"], sections: SECTIONS, compact: true });
  assert.equal(compact.showSections, false);
  assert.equal(compact.done, 0);
  assert.equal(compact.total, 4);
  const full = onboardingChecklist({ missing: [], sections: SECTIONS });
  assert.equal(full.showSections, true);
  assert.equal(full.done, 5);
  assert.equal(full.total, 6);
  assert.deepEqual(full.asks, ["my personalization (deal breakers)"]);
});

test("compact mode still asks for a missing personalization file", () => {
  const compact = onboardingChecklist({ missing: ["cv.md", "modes/_profile.md"], sections: SECTIONS, compact: true });
  assert.deepEqual(compact.asks, ["my CV", "my personalization file (modes/_profile.md)"]);
  // The full list asks through its sections line instead, not twice.
  const full = onboardingChecklist({ missing: ["modes/_profile.md"], sections: SECTIONS });
  assert.deepEqual(full.asks, ["my personalization (deal breakers)"]);
});

test("checklist prereq keys match the doctor list", () => {
  const doctor = readFileSync(join(root, "../doctor.mjs"), "utf8");
  const block = doctor.match(/const USER_LAYER_PREREQS = \[([\s\S]*?)\n\];/);
  assert.ok(block, "doctor.mjs still lists USER_LAYER_PREREQS");
  const paths = [...block[1].matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(PREREQS.map((item) => item.key), paths);
});

test("first-run home renders the compact checklist", () => {
  const home = readFileSync(join(root, "src/components/home/first-run-home.tsx"), "utf8");
  assert.match(home, /<OnboardingProgress compact/);
});
