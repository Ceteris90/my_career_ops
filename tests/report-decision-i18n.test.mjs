// Localized report templates carry the same two header lines as modes/oferta.md.
// The label and the four values are in that language. readReport maps every
// label to the canonical Decision field the web report view already reads.
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

console.log('\nreports: localized decision header');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function check(name, fn) {
  try {
    const problem = fn();
    if (problem) fail(`${name}: ${problem}`);
    else pass(name);
  } catch (err) {
    fail(`${name}: ${err.message}`);
  }
}

// score line, decision line, lede placeholder, fictional apply-word.
const LOCALES = [
  ['modes/ar/fursah.md', '**Score:** {X/5}', '**القرار:** {تقدّم | فكّر | ابحث أولاً | تجاوز}', '{جملة `## القرار (lead)` منسوخة حرفياً}', 'تقدّم'],
  ['modes/da/oferta.md', '**Score:** {X/5}', '**Beslutning:** {Søg | Overvej | Undersøg først | Spring over}', '{sætningen om at søge, kopieret ordret}', 'Søg'],
  ['modes/de/angebot.md', '**Score:** {X/5}', '**Entscheidung:** {Bewerben | Prüfen | Zuerst recherchieren | Überspringen}', '{der Bewerbungssatz, wortgleich kopiert}', 'Bewerben'],
  ['modes/es/oferta.md', '**Score:** {X/5}', '**Decisión:** {Presentarse | Valorar | Investigar primero | Descartar}', '{la frase de `## Veredicto (lead)`, copiada tal cual}', 'Presentarse'],
  ['modes/fr/offre.md', '**Score :** {X/5}', '**Décision:** {Postuler | Envisager | Chercher d\'abord | Passer}', '{la phrase postuler ou non, copiée telle quelle}', 'Postuler'],
  ['modes/hi/naukri.md', '**Score:** {X/5}', '**निर्णय:** {आवेदन करें | विचार करें | पहले जाँचें | छोड़ें}', '{आवेदन वाला वाक्य, ज्यों का त्यों}', 'आवेदन करें'],
  ['modes/id/lowongan.md', '**Score:** {X/5}', '**Keputusan:** {Lamar | Pertimbangkan | Teliti dulu | Lewati}', '{kalimat lamar atau tidak, disalin apa adanya}', 'Lamar'],
  ['modes/it/annuncio.md', '**Punteggio:** {X/5}', '**Decisione:** {Candidarsi | Valutare | Approfondire prima | Scartare}', '{la frase candidarsi o no, copiata parola per parola}', 'Candidarsi'],
  ['modes/ja/kyujin.md', '**Score:** {X/5}', '**決定:** {応募する | 検討する | 先に調べる | 見送る}', '{`## 判定 (lead)` の一文をそのまま写す}', '応募する'],
  ['modes/ko/gonggo.md', '**Score:** {X/5}', '**결정:** {지원 | 검토 | 먼저 조사 | 건너뛰기}', '{지원 여부를 한 문장으로, 그대로 복사}', '지원'],
  ['modes/nl/vacature.md', '**Score:** {X/5}', '**Beslissing:** {Solliciteren | Overwegen | Eerst onderzoeken | Overslaan}', '{de zin over wel of niet solliciteren, woordelijk gekopieerd}', 'Solliciteren'],
  ['modes/pl/oferta.md', '**Score:** {X/5}', '**Decyzja:** {Aplikuj | Rozważ | Najpierw sprawdź | Pomiń}', '{zdanie o aplikacji, skopiowane słowo w słowo}', 'Aplikuj'],
  ['modes/pt/oferta.md', '**Score:** {X/5}', '**Decisão:** {Candidatar | Considerar | Pesquisar primeiro | Não candidatar}', '{a frase de candidatar ou não, copiada palavra por palavra}', 'Candidatar'],
  ['modes/ru/oferta.md', '**Score:** {X/5}', '**Решение:** {Откликнуться | Рассмотреть | Сначала изучить | Пропустить}', '{предложение из `## Вердикт (lead)`, дословно}', 'Откликнуться'],
  ['modes/tr/is-ilani.md', '**Puan:** {X.X}/5', '**Karar:** {Başvur | Değerlendir | Önce araştır | Geç}', '{`## Karar (lead)` cümlesi, kelimesi kelimesine}', 'Başvur'],
  ['modes/ua/oferta.md', '**Бал:** {X/5}', '**Рішення:** {Відгукнутися | Розглянути | Спочатку дослідити | Пропустити}', '{речення про відгук, дослівно}', 'Відгукнутися'],
  ['modes/vi/tuyen-dung.md', '**Score:** {X/5}', '**Quyết định:** {Nộp hồ sơ | Cân nhắc | Tìm hiểu trước | Bỏ qua}', '{câu của `## Kết luận (lead)`, chép nguyên văn}', 'Nộp hồ sơ'],
  ['modes/zh/oferta.md', '**Score:** {X/5}', '**决定:** {申请 | 考虑 | 先调研 | 跳过}', '{`## 结论 (lead)` 的那一句，逐字复制}', '申请'],
  ['modes/zh-TW/oferta.md', '**Score:** {X/5}', '**決定:** {應徵 | 考慮 | 先調查 | 略過}', '{`## 結論 (lead)` 的那一句，逐字複製}', '應徵'],
];

function headerAfterScore(text, scoreLine) {
  const at = text.indexOf(scoreLine);
  if (at < 0) return null;
  const from = text.slice(at);
  const end = from.indexOf('\n---');
  return end < 0 ? null : from.slice(0, end);
}

for (const [file, scoreLine, decisionLine, lede, applyWord] of LOCALES) {
  check(`${file} puts a translated decision under the score`, () => {
    const header = headerAfterScore(read(file), scoreLine);
    if (!header) return `score line not found: ${scoreLine}`;
    const lines = header.split('\n');
    if (lines[1] !== decisionLine) return `line after score is ${JSON.stringify(lines[1])}`;
    if (!lines.includes(lede)) return `lede missing: ${lede}`;
    if (/verdict\s*:/i.test(header)) return 'header contains Verdict:';
    const label = decisionLine.match(/^\*\*(.+):\*\*/)[1];
    if (/verdict/i.test(label)) return `label ${label} collides with VERDICT`;
    if (!applyWord || !decisionLine.includes(applyWord)) return 'apply word missing from the decision line';
    return null;
  });
}

const { readReport } = await import(pathToFileURL(join(ROOT, 'web/src/lib/report-header.mjs')).href);

check('a translated header reads as Decision', () => {
  const report = `# Evaluation: Example Labs — Researcher

**Score:** 3.4/5
**Entscheidung:** Bewerben
**URL:** https://jobs.example/researcher

---

Example Labs is a fictional employer.
`;
  const fields = readReport(report).fields;
  const decision = fields.find((f) => f.label === 'Decision');
  if (!decision || decision.value !== 'Bewerben') return JSON.stringify(fields);
  const score = fields.find((f) => f.label === 'Score');
  if (!score || score.value !== '3.4/5') return JSON.stringify(fields);
  return null;
});

check('English Decision and a legacy Date alias still resolve', () => {
  const report = `# Evaluation: Example Labs — Researcher

**Fecha:** 2026-10-18
**Decision:** Research first

---
`;
  const fields = readReport(report).fields;
  const decision = fields.find((f) => f.label === 'Decision');
  const date = fields.find((f) => f.label === 'Date');
  if (!decision || decision.value !== 'Research first') return JSON.stringify(fields);
  if (!date || date.value !== '2026-10-18') return JSON.stringify(fields);
  return null;
});

check('a Verdict label is not a decision and not a score latch', () => {
  const report = `# Evaluation: Example Labs — Researcher

**Verdict:** Apply
**Score:** 3.4/5

---
`;
  const fields = readReport(report).fields;
  if (fields.some((f) => f.label === 'Decision')) return JSON.stringify(fields);
  if (/verdict\s*:/i.test('**Verdict:** Apply') !== true) return 'fixture lost the latch shape';
  return null;
});

for (const [file, , decisionLine, , applyWord] of LOCALES) {
  const label = decisionLine.match(/^\*\*(.+):\*\*/)[1];
  check(`${file} parser reads ${label}`, () => {
    const report = `# Evaluation: Example Labs — Researcher

**${label}:** ${applyWord}
**URL:** https://jobs.example/researcher

---
`;
    const decision = readReport(report).fields.find((f) => f.label === 'Decision');
    if (!decision || decision.value !== applyWord) return JSON.stringify(readReport(report).fields);
    return null;
  });
}
