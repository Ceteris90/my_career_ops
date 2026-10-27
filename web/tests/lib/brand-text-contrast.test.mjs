import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const GLOBALS = path.join(SRC, "app/globals.css");

const RAW_BRAND_FILL_AS_TEXT = /(?<![\w-])text-brand(?![\w-])/;
const RAW_BRAND_TEXT_CSS = /(?<![\w-])color:\s*var\(--color-brand\)/;

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && /\.(tsx?|jsx?|mjs|css)$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

async function rawBrandTextUses() {
  const hits = [];
  for (const file of await sourceFiles(SRC)) {
    const pattern = file.endsWith(".css") ? RAW_BRAND_TEXT_CSS : RAW_BRAND_FILL_AS_TEXT;
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

function rootTokens(css) {
  const block = css.match(/:root\s*\{([^}]*)\}/)?.[1];
  assert.ok(block, "globals.css must define a :root block");
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
}

function toRgb(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const hsl = value.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/);
  assert.ok(hsl, `unparseable color: ${value}`);
  const [h, s, l] = [Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100];
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function luminance(value) {
  const [r, g, b] = toRgb(value).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("contrast math matches known WCAG ratios", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrast("#767676", "#ffffff").toFixed(2), "4.54");
});

test("the light brand-text token reaches AA (4.5:1) on every light surface", async () => {
  const tokens = rootTokens(await readFile(GLOBALS, "utf8"));
  for (const surface of ["bg", "surface", "surface-hover"]) {
    const ratio = contrast(tokens["brand-text"], tokens[surface]);
    assert.ok(ratio >= 4.5, `--brand-text on --${surface} is ${ratio.toFixed(2)}:1, below 4.5:1`);
  }
});

test("no component colors text with the raw brand fill", async () => {
  const hits = await rawBrandTextUses();
  assert.deepEqual(
    hits,
    [],
    `${hits.length} text uses of the raw brand orange (about 3:1 on light surfaces); use text-brand-text / var(--color-brand-text):\n${hits.join("\n")}`,
  );
});
