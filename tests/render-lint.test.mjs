// tests/render-lint.test.mjs — renderLint reports what generate-pdf.mjs drops
// silently (#5941): JavaScript is off and every request that is not file: or
// data: is aborted, so a template carrying either renders without it and says
// nothing. One positive and one negative case per rule; each negative is the
// rule's must-not-flag clause from the issue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderLint } from '../cv-templates.mjs';

const ROOT = join(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'render-lint-'));
let n = 0;
function lint(html) {
  const p = join(dir, `t${n++}.html`);
  writeFileSync(p, html);
  return renderLint(p);
}
const ids = (r) => r.findings.map((f) => f.id);

const CASES = [
  {
    id: 'script-element',
    hit: ['<body><script>fetch("x")</script></body>', '<SCRIPT src="a.js"></SCRIPT>'],
    miss: ['<p>Wrote a script for the pipeline</p>', '<noscript>Enable JS</noscript>', '<!-- <script>x</script> -->', '<img alt="<script>" src="a.png">', '<textarea><script>x</script></textarea>', '<template><script>x</script></template>', '<svg><text><![CDATA[<script>x</script>]]></text></svg>'],
  },
  {
    id: 'embedded-content',
    hit: ['<iframe src="a.html"></iframe>', '<object data="a.pdf"></object>', '<embed src="a.svg">'],
    miss: ['<img src="a.png">', '<svg><rect/></svg>', '<img alt="<iframe>" src="a.png">', '<iframe srcdoc="<p>Hello</p>"></iframe>', '<IFRAME SRCDOC=\'<p>Hello</p>\'></IFRAME>'],
  },
  {
    id: 'event-handler-attribute',
    hit: ['<body onload="x()">', '<img src="a.png" onerror=x()>', '<a href="#" ONCLICK="x()">go</a>', '<svg/onload=x()>', '<img src="a.png"onerror=x()>', '<img src=\'a.png\'onerror=x()>'],
    miss: ['<p title="once=twice">x</p>', '<div data-onclick="x">x</div>', '<p>onload= in text</p>', '<a href=/onload=x>x</a>', '<a href=a/onclick=b>x</a>', '<img src="a.png" alt=x/onerror=y>', '<template><img src="a.png" onerror="x()"></template>', '<textarea><img onerror=x()></textarea>'],
  },
  {
    id: 'script-url',
    hit: ['<a href="&#106;avascript:alert(1)">x</a>', '<a href="javascript&#58;alert(1)">x</a>', '<a href="javascript:alert(1)">x</a>', '<a href="javascript&colon;alert(1)">x</a>', '<img src=" JavaScript:x()">', '<a href="data:text/html,<b>x</b>">x</a>', '<a href="java&#9;script:alert(1)">x</a>', '<a href="java&Tab;script:alert(1)">x</a>', '<a href="java&NewLine;script:alert(1)">x</a>', '<a href="java\nscript:alert(1)">x</a>', '<a href="java\tscript:alert(1)">x</a>'],
    miss: ['<img src="data:image/png;base64,AAAA">', '<style>@font-face{src:url("data:font/woff2;base64,AAAA")}</style>', '<a href="{{LINKEDIN_URL}}">x</a>'],
  },
  {
    id: 'meta-refresh',
    hit: ['<meta http-equiv="refresh" content="0;url=a.html">', '<meta http-equiv="refresh" content=" 3 ; url=a.html">', '<meta http-equiv="refresh" content="5">'],
    // Chromium follows a refresh that parses to a time (the remote target is requested, then aborted)
    // and ignores one with no content, an empty one, or one whose content does not start with a number.
    miss: ['<meta charset="utf-8">', '<meta name="viewport" content="width=device-width">', '<meta http-equiv="refresh">', '<meta http-equiv="refresh" content="">', '<meta http-equiv="refresh" content="x">', '<meta http-equiv="refresh" content="url=a.html">', '<template><meta http-equiv="refresh" content="0;url=a.html"></template>'],
  },
  {
    id: 'remote-subresource',
    hit: [
      '<img src="https://example.com/a.png">',
      '<link rel="stylesheet" href="//fonts.example.com/a.css">',
      '<style>@import url("https://fonts.example.com/a.css");</style>',
      '<style>@import "https://fonts.example.com/a.css";</style>',
      '<style>body{background:url(http://example.com/a.png)}</style>',
      '<div style="background:url(\'https://example.com/a.png\')"></div>',
      '<img alt="src=photo.png" src="https://example.com/a.png">',
      '<img src="https&#58;//example.com/a.png">',
      '<img src="&#104;ttps://example.com/a.png">',
      '<img src="https&#58//example.com/a.png">',
      '<img src="ftp://example.com/a.png">',
      '<img src="https&colon;//example.com/a.png">',
      '<img src="https&colon;&sol;&sol;example.com/a.png">',
      '<style><!-- @import url(https://fonts.example.com/a.css); --></style>',
      '<style><!--\nbody{background:url(https://example.com/a.png)}\n--></style>',
      '<base href="https://cdn.example/"><img src="logo.png">',
      '<base href="https://cdn.example/"><link rel="stylesheet" href="css/a.css">',
      '<base href="https://cdn.example/"><img srcset="a.png 1x, b.png 2x">',
      '<base href="https://cdn.example/"><style>body{background:url(img/a.png)}</style>',
      '<base href="https://cdn.example/"><style>@import "a.css";</style>',
      '<style type="text/css">body{background:url(https://example.com/a.png)}</style>',
      '<style>body{background:url(ftp://example.com/a.png)}</style>',
      '<img src="https&#x3a//example.com/a.png">',
      '<style>body{background:url(https://example.com/a.png);content:"<style>"}</style>',
      '<div style="background:url(&quot;https://example.com/a.png&quot;)"></div>',
      '<STYLE>body{background:URL(https://example.com/a.png)}</STYLE>',
      '<img srcset="photo.png 1x, https://example.com/photo.png 2x">',
      // Quoted @import needs no whitespace after the at-keyword.
      '<style>@import"https://fonts.example.com/a.css";</style>',
      "<style>@import'https://fonts.example.com/a.css';</style>",
      '<base href="https://cdn.example/"><style>@import"a.css";</style>',
      // A data URL's comma is not a candidate separator, so a remote candidate after it still counts.
      '<img srcset="data:image/png;base64,AAAA 1x, https://example.com/a.png 2x">',
      '<base href="https://cdn.example/"><img srcset="data:image/png;base64,AAAA 1x, b.png 2x">',
      // The URL parser drops tab, LF and CR anywhere in a URL.
      '<img src="ht&#9;tps://example.com/a.png">',
      '<img src="ht&Tab;tps://example.com/a.png">',
      '<img src="ht&NewLine;tps://example.com/a.png">',
      '<img src="ht\ntps://example.com/a.png">',
      '<img src="ht\ttps://example.com/a.png">',
      '<img src="https://example.com/\r\na.png">',
      '<link rel="stylesheet" href="ht&#10;tps://example.com/a.css">',
      '<base href="ht&#9;tps://cdn.example/"><img src="logo.png">',
      // A fragment-only resource URL resolves against a remote <base href>.
      '<base href="https://cdn.example/icon.svg"><img src="#logo">',
      '<base href="https://cdn.example/"><img srcset="#a 1x">',
      '<base href="https://cdn.example/"><link rel="stylesheet" href="#x">',
      // A special scheme needs no `//`: the URL parser resolves each of these to a remote host,
      // and Chromium routes (and the renderer aborts) every one, probed with javaScriptEnabled:false.
      '<img src="https:example.com/logo.png">',
      '<img src="HTTPS:example.com/a.png">',
      '<img src="http:example.com/a.png">',
      '<img src="https:/example.com/a.png">',
      '<img src="https:///example.com/a.png">',
      '<img src="https:\\\\example.com\\a.png">',
      '<img src="https:/\\example.com/a.png">',
      '<img src="ftp:example.com/a.png">',
      '<img src="ws://example.com/a.png">',
      '<img src="wss:example.com/a.png">',
      '<img src=" https:example.com/a.png">',
      '<img srcset="a.png 1x, https:example.com/a.png 2x">',
      '<link rel="stylesheet" href="https:example.com/a.css">',
      '<style>body{background:url(https:example.com/a.png)}</style>',
      '<style>@import "https:example.com/a.css";</style>',
      '<base href="file:///tmp/"><img src="https:example.com/a.png">',
      // Scheme-relative in either slash direction, as `//host` already was.
      '<img src="\\\\example.com\\a.png">',
      '<img src="/\\example.com/a.png">',
      '<img src="\\/example.com/a.png">',
      // A base without `//` still names a remote origin.
      '<base href="https:cdn.example/"><img src="logo.png">',
      // The markup of an iframe srcdoc is fetched like the page's own (probed with javaScriptEnabled:false).
      '<iframe srcdoc="<img src=\'https://example.com/a.png\'>"></iframe>',
      '<iframe srcdoc="&lt;img src=&quot;https://example.com/a.png&quot;&gt;"></iframe>',
      '<iframe srcdoc="<link rel=stylesheet href=\'https://example.com/a.css\'>"></iframe>',
      '<iframe srcdoc="<style>@import \'https://example.com/a.css\'</style>"></iframe>',
      '<iframe srcdoc="<style>body{background:url(https://example.com/a.png)}</style><p>x"></iframe>',
      '<iframe srcdoc="<iframe srcdoc=\'&lt;img src=&quot;https://example.com/a.png&quot;&gt;\'></iframe>"></iframe>',
      // The srcdoc document inherits the parent's base URL, and its own <base> overrides it.
      '<base href="https://cdn.example/"><iframe srcdoc="<img src=\'logo.png\'>"></iframe>',
      '<iframe srcdoc="<base href=\'https://own.example/\'><img src=\'logo.png\'>"></iframe>',
      // Comment markers inside a quoted attribute or a CSS string are text, so the live request after them still counts.
      '<img alt="<!--" src="https://example.com/a.png">-->',
      '<!--><img src="https://example.com/a.png">',
      '<!---><img src="https://example.com/a.png">',
      '<style>.x{--a:"/*";background-image:url(https://example.com/a.png);--b:"*/"}</style>',
      '<style>.x{--a:\'/*\';background:url(https://example.com/a.png)}/* "real" */</style>',
      '<style>.x{background:url(https://example.com/a/*b*/.png)}</style>',
      // image-set() takes bare string candidates, which are requests too.
      '<style>.x{background-image:image-set("https://example.com/a.png" 1x)}</style>',
      '<style>.x{background-image:-webkit-image-set(\'https:example.com/a.png\' 1x)}</style>',
      '<base href="https://cdn.example/"><style>.x{background-image:image-set("a.png" 1x)}</style>',
      // Attribute and element forms the HTML parser accepts.
      '<img/src=https://example.com/a.png>',
      '<svg><defs><filter id="f"><feImage href="https://example.com/a.png"/></filter></defs></svg>',
      '<svg><defs><filter id="f"><feImage xlink:href="https://example.com/a.png"/></filter></defs></svg>',
      '<svg><style><![CDATA[.s{background:url(https://example.com/a.png)}]]></style></svg>',
      '<svg><style>.s{background:url(https://example.com/a.png)}</style></svg>',
      // JavaScript is off, so <noscript> content is parsed as markup and requested.
      '<noscript><img src="https://example.com/a.png"></noscript>',
      '<template></template><img src="https://example.com/a.png">',
      '<img src="&#1;https://example.com/a.png">',
      '<video><source src="https://example.com/a.mp4"></video>',
      '<audio><source src="https://example.com/a.mp3"></audio>',
      '<picture><video><source src="https://example.com/a.mp4"></video></picture>',
      '<picture><source srcset="https://example.com/a.png"><img alt=""></picture>',
      '<input type="image" src="https://example.com/a.png">',
      '<input type=IMAGE src="https://example.com/a.png">',
      '<link rel="alternate stylesheet" href="https://example.com/a.css">',
      '<link rel="preload" as="image" href="https://example.com/a.png">',
      '<link rel="prefetch" href="https://example.com/a.html">',
      // Any scheme with an authority is aborted by the route, not just the special ones (probed).
      '<img src="gopher://example.com/a.png">',
      '<img src="foo://example.com/a.png">',
      '<img src="chrome-extension://example.com/a.png">',
      '<img src="intent://example.com/a">',
      '<style>.a{background:url(foo://example.com/a.png)}</style>',
      // With no remote base the document is a file: URL, so `//host` is file://host/..., which does not load (probed).
      '<img src="file://example.com/a.png">',
      '<img src="\\\\example.com\\a.png">',
      // Foreign content: svg title/desc/foreignObject are HTML integration points, a breakout tag leaves svg,
      // and a script in svg is markup, not raw text (probed).
      '<svg><title><img src="https://example.com/a.png"></title></svg>',
      '<svg><desc><img src="https://example.com/a.png"></desc></svg>',
      '<svg><textarea><img src="https://example.com/a.png"></textarea></svg>',
      '<svg><foreignObject><img src="https://example.com/a.png"></foreignObject></svg>',
      '<svg><iframe><img src="https://example.com/a.png"></iframe></svg>',
      '<svg><xmp><img src="https://example.com/a.png"></xmp></svg>',
      '<svg><noscript><img src="https://example.com/a.png"></noscript></svg>',
      '<svg><script>var s="<img src=\'https://example.com/a.png\'>";</script></svg>',
      '<svg><foreignObject><div></div></foreignObject><textarea><img src="https://example.com/a.png"></textarea></svg>',
      '<svg><g/><img src="https://example.com/a.png"></svg>',
      '<svg/><img src="https://example.com/a.png">',
      '<p><svg><p><img src="https://example.com/a.png"></svg>',
      '<math><annotation-xml encoding="x"><textarea><img src="https://example.com/a.png"></textarea></annotation-xml></math>',
      // Tokenizer corner cases (probed): the end tag wins over comment and string syntax inside raw text.
      '<template><script>var a="</template>";</script></template><img src="https://example.com/a.png">',
      '<textarea><!-- </textarea><img src="https://example.com/a.png"> -->',
      '<script><!-- var a = "</script><img src=\'https://example.com/a.png\'>";</script>',
      '<style>/* </style><img src="https://example.com/a.png"> */</style>',
      '<template><svg><title></template><img src="https://example.com/a.png"></title></svg></template>',
      // CSS escapes are decoded before the URL is classified.
      '<style>@import "\\68 ttps://example.com/a.css";</style>',
      '<style>@import url("\\68 ttps://example.com/a.css");</style>',
      '<style>@import url(\\68 ttps://example.com/a.css);</style>',
      '<style>@\\69 mport "https://example.com/a.css";</style>',
      '<style>.a{background:url("\\68 ttps://example.com/a.png")}</style>',
      '<style>.a{background:url(\\68 ttps://example.com/a.png)}</style>',
      '<style>.a{background:url("https\\3a //example.com/a.png")}</style>',
      '<style>.a{background:url("https:\\/\\/example.com/a.png")}</style>',
      '<style>.a{background:url("\\000068ttps://example.com/a.png")}</style>',
      '<style>.a{background:url("h\\ttps://example.com/a.png")}</style>',
      '<style>.a{background:\\75 rl("https://example.com/a.png")}</style>',
      '<style>.a{background:u\\72l(https://example.com/a.png)}</style>',
      '<style>.a{background:url("htt\\\nps://example.com/a.png")}</style>',
      '<style>.a{background:url("https://example.com/a\\2e png")}</style>',
      '<div style="background:url(&quot;\\68 ttps://example.com/a.png&quot;)"></div>',
      '<base href="https://cdn.example/"><style>.a{background:url("\\69 mg/a.png")}</style>',
    ],
    miss: [
      '<a href="https://example.com/me">me</a>',
      '<img src="{{PHOTO}}">',
      '<img src="photo.png">',
      '<link rel="stylesheet" href="fonts/a.css">',
      '<style>@font-face{src:url("./fonts/a.woff2")}</style>',
      '<style>/* url(https://example.com/a.png) */ body{}</style>',
      '<img alt="src=https://example.com/a.png" src="photo.png">',
      '<img srcset="photo.png 1x, photo-2x.png 2x">',
      '<title>url(https://example.com/a.png)</title>',
      '<style type="text/plain">body{background:url(https://example.com/a.png)}</style>',
      '<img src="#frag"><img src="">',
      '<!-- <style>@import url(https://fonts.example.com/a.css);</style> -->',
      '<p>x</p><!-- <img src="https://example.com/a.png"> --><style>body{color:#000}</style>',
      '<base href="https://cdn.example/"><img src="data:image/png;base64,AAAA"><img src="{{PHOTO}}"><a href="rel.html">x</a>',
      '<base href="https://cdn.example/"><style>body{background:url(data:image/png;base64,AAAA)}</style>',
      '<base href="file:///tmp/"><img src="logo.png">',
      '<base target="_blank"><img src="logo.png">',
      '<img alt="<style>body{background:url(https://example.com/a.png)}</style>" src="a.png">',
      '<p>Docs: url(https://example.com/a.png) and @import "https://example.com/a.css"</p>',
      // A data: srcset candidate stays local under a remote base, whatever its comma does.
      '<base href="https://cdn.example/"><img srcset="data:image/png;base64,AAAA 1x">',
      '<base href="https://cdn.example/"><img srcset="data:image/png;base64,AAAA">',
      '<base href="https://cdn.example/"><source srcset="data:image/svg+xml,%3Csvg%3E 1x, data:image/png;base64,BBBB 2x">',
      // Tab/LF/CR separate srcset candidates and descriptors; they are not stripped before the split.
      '<img srcset="a.png\n1x,\nb.png\t2x">',
      // rel is read raw: stripping would turn this into a stylesheet link.
      '<link rel="style\nsheet" href="https://example.com/a.css">',
      // Same-document references stay local under a remote base.
      '<base href="https://cdn.example/"><svg><use href="#a"/></svg>',
      '<base href="https://cdn.example/"><style>.a{fill:url(#g)}</style>',
      // Not fetched by the renderer (JavaScript is off), so nothing is dropped: probed with
      // Playwright's javaScriptEnabled:false context, where modulepreload and icon never reach route().
      '<link rel="modulepreload" href="https://cdn.example/m.js">',
      // Text in raw-text, RCDATA, CDATA and inert template content is not markup, so nothing is requested.
      '<textarea><img src="https://example.com/a.png"></textarea>',
      '<title><img src="https://example.com/a.png"></title>',
      '<script>var s = \'<img src="https://example.com/a.png">\';</script>',
      '<svg><text><![CDATA[<image href="https://example.com/a.png"/>]]></text></svg>',
      '<xmp><img src="https://example.com/a.png"></xmp>',
      '<iframe><img src="https://example.com/a.png"></iframe>',
      '<template><img src="https://example.com/a.png"></template>',
      '<template><base href="https://cdn.example/"></template><img src="photo.png">',
      '<style>.x::before{content:"url(https://example.com/a.png)"}</style>',
      '<style>.x{font-family:"url(https://example.com/a.png)"}</style>',
      '<style>@namespace url("https://example.com/ns");</style>',
      '<style>@namespace svg url(https://example.com/ns);</style>',
      // The renderer fetches an input src only for type=image, and a source src only inside video or audio.
      '<input type="hidden" src="https://example.com/a.png">',
      '<input src="https://example.com/a.png">',
      '<input type="text" src="https://example.com/a.png">',
      '<source src="https://example.com/a.png">',
      '<picture><source src="https://example.com/a.png"><img alt=""></picture>',
      '<source srcset="https://example.com/a.png">',
      '<video><source srcset="https://example.com/a.png"></video>',
      '<track src="https://example.com/a.vtt">',
      '<video><track src="https://example.com/a.vtt" kind="subtitles" default></video>',
      // Never requested with JavaScript off: icons, a preload with no `as`, a rel that only contains a fetching word.
      '<link rel="icon" href="https://example.com/favicon.ico">',
      '<link rel="shortcut icon" href="https://example.com/favicon.ico">',
      '<link rel="apple-touch-icon" href="https://example.com/a.png">',
      '<link rel="preload" href="https://example.com/a.png">',
      '<link rel="x-stylesheet" href="https://example.com/a.css">',
      // No authority, no request: Chromium never issues these (probed), so they are not flagged.
      '<img src="urn:example">',
      '<img src="cid:logo@example">',
      '<img src="blob:https://example.com/x">',
      '<img src="about:blank">',
      '<img src="chrome://example.com/a.png">',
      '<img src="file://localhost/tmp/a.png">',
      '<img src="file:///tmp/a.png">',
      // Raw text, RCDATA and template content inside foreign content and its HTML integration points (probed).
      '<svg><foreignObject><textarea><img src="https://example.com/a.png"></textarea></foreignObject></svg>',
      '<svg><foreignObject><title><img src="https://example.com/a.png"></title></foreignObject></svg>',
      '<svg><desc><textarea><img src="https://example.com/a.png"></textarea></desc></svg>',
      '<svg><title><textarea><img src="https://example.com/a.png"></textarea></title></svg>',
      '<math><mtext><textarea><img src="https://example.com/a.png"></textarea></mtext></math>',
      '<math><mi><title><img src="https://example.com/a.png"></title></mi></math>',
      '<math><annotation-xml encoding="text/html"><textarea><img src="https://example.com/a.png"></textarea></annotation-xml></math>',
      '<math><annotation-xml encoding="application/xhtml+xml"><textarea><img src="https://example.com/a.png"></textarea></annotation-xml></math>',
      '<svg><p></p><textarea><img src="https://example.com/a.png"></textarea></svg>',
      '<svg></svg><textarea><img src="https://example.com/a.png"></textarea>',
      '<svg><script><![CDATA[var s="<img src=\'https://example.com/a.png\'>";]]></script></svg>',
      '<template><textarea></template><img src="https://example.com/a.png"></textarea></template>',
      '<template><script>var a="</template>";</script><img src="https://example.com/a.png"></template>',
      '<template><template></template><img src="https://example.com/a.png"></template>',
      '<template><template><img src="https://example.com/a.png"></template></template>',
      '<template><style>.a{background:url(https://example.com/a.png)}</style></template>',
      // A host the URL parser rejects is not requested.
      '<img src="https://exa%00mple.test/a.png">',
      '<img src="https://exa&#0;mple.test/a.png">',
      // Local files and data stay quiet under both kinds of base, with or without `//`.
      '<img src="file:logo.png">',
      '<base href="https://cdn.example/"><img src="file:///tmp/a.png">',
      '<base href="https://cdn.example/"><img src="data:image/png;base64,AAAA">',
      '<base href="https:cdn.example/"><img src="{{PHOTO}}">',
      // A srcdoc with nothing remote in it stays quiet.
      '<iframe srcdoc="<p>Hello</p>"></iframe>',
      '<iframe srcdoc="<img src=\'data:image/png;base64,AAAA\'><img src=\'a.png\'>"></iframe>',
      '<iframe srcdoc="<!-- <img src=\'https://example.com/a.png\'> -->"></iframe>',
      '<iframe srcdoc="<p>https://example.com/a.png</p>"></iframe>',
      // The src is ignored when srcdoc is present, so only the srcdoc markup counts.
      '<iframe srcdoc="<p>x</p>" src="a.html"></iframe>',
      // CSS escapes that decode to a local path stay local; a non-url() string is not a request.
      '<style>.a{background:url("\\66 ile.png")}</style>',
      '<style>.a{background:url("\\70 hoto.png")}</style>',
      '<style>.a{content:"\\68 ttps://example.com/a.png"}</style>',
      '<style>.a{background:url("\\68  ttps://example.com/a.png")}</style>',
    ],
  },
];

for (const { id, hit, miss } of CASES) {
  test(`${id}: flags the construct`, () => {
    for (const html of hit) assert.ok(ids(lint(html)).includes(id), `expected ${id} for: ${html}`);
  });
  test(`${id}: stays quiet on what it must not flag`, () => {
    for (const html of miss) assert.ok(!ids(lint(html)).includes(id), `unexpected ${id} for: ${html}`);
  });
}

test('srcdoc nested past the cap is surfaced by a depth-limit finding, never silently passed', () => {
  const nest = (inner, levels) => {
    let html = inner;
    for (let i = 0; i < levels; i++) html = `<iframe srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"></iframe>`;
    return html;
  };
  const remote = '<img src="https://example.com/a.png">';
  const local = '<img src="a.png">';
  assert.ok(ids(lint(nest(remote, 3))).includes('remote-subresource'), 'inside the cap the remote request is named');
  assert.deepEqual(ids(lint(nest(local, 8))), [], 'local-only nesting inside the cap is valid');
  const past = lint(nest(remote, 40));
  assert.equal(past.error, null);
  assert.ok(ids(past).includes('srcdoc-depth-limit'), 'a remote request past the cap still fails through the depth-limit finding');
  assert.ok(!ids(past).includes('remote-subresource'), 'the capped iframe is not labelled a remote subresource');
  assert.ok(ids(lint(nest(local, 40))).includes('srcdoc-depth-limit'), 'content past the cap cannot be proven local, so it is reported too');
});

test('the meta-refresh text says what a refresh does (probed: a local target replaces the printed document, a remote one is aborted)', () => {
  const [f] = lint('<meta http-equiv="refresh" content="0;url=a.html">').findings;
  assert.equal(f.id, 'meta-refresh');
  assert.match(f.rule, /navigates the page/);
  assert.match(f.rule, /replaces the document/);
  assert.match(f.rule, /aborted/);
  assert.doesNotMatch(f.rule, /not followed/);
});

test('the depth-limit text says the srcdoc could not be checked, not that it fetches something', () => {
  let html = '<img src="a.png">';
  for (let i = 0; i < 20; i++) html = `<iframe srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"></iframe>`;
  const f = lint(html).findings.find((x) => x.id === 'srcdoc-depth-limit');
  assert.ok(f);
  assert.match(f.rule, /could not be checked/);
  assert.match(f.rule, /deeper than 16 levels/);
  assert.doesNotMatch(f.rule, /request|fetch/);
});

test('every finding is a warning with a rule text and a detail', () => {
  const r = lint('<script>x</script>');
  assert.equal(r.ok, false);
  assert.equal(r.error, null);
  for (const f of r.findings) {
    assert.equal(f.severity, 'warning');
    assert.ok(f.rule && f.detail);
  }
});

test('a clean template reports ok', () => {
  const r = lint('<html><head><meta charset="utf-8"><style>body{color:#000}</style></head><body><h1>{{NAME}}</h1></body></html>');
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
});

test('an unreadable path is reported, never thrown', () => {
  const r = renderLint(join(dir, 'missing.html'));
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

// The child gets a throwaway data root, so a template the developer keeps in
// their own data/templates cannot change what `standard` resolves to.
function lintCli(userCv) {
  const root = mkdtempSync(join(tmpdir(), 'render-lint-root-'));
  try {
    if (userCv !== undefined) {
      mkdirSync(join(root, 'data', 'templates'), { recursive: true });
      writeFileSync(join(root, 'data', 'templates', 'cv-template.standard.html'), userCv);
    }
    const out = execFileSync(process.execPath, ['cv-templates.mjs', 'lint', 'cv', 'standard', '--render'], {
      cwd: ROOT, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
    });
    return JSON.parse(out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('lint --render runs the render check and exits 0 on findings', () => {
  const parsed = lintCli();
  assert.ok(Array.isArray(parsed.findings));
  assert.equal(parsed.ok, true);
  const dirty = lintCli('<html><body><img src="https://example.com/a.png"><h1>{{NAME}}</h1>{{SECTION_EXPERIENCE}}{{EXPERIENCE}}{{SECTION_EDUCATION}}{{EDUCATION}}</body></html>');
  assert.equal(dirty.ok, false);
  assert.ok(dirty.findings.some((f) => f.id === 'remote-subresource'));
});

// Tracked files only: listTemplates() also walks templates/<pack>/ and any
// template the developer added, so a local install could fail this test.
function trackedTemplates() {
  try {
    return execFileSync('git', ['ls-files', '-z', 'templates'], { cwd: ROOT, encoding: 'utf-8' })
      .split('\0').filter((f) => f.endsWith('.html')).map((f) => join(ROOT, f));
  } catch {
    return null;
  }
}

test('the shipped templates are clean', (t) => {
  const shipped = trackedTemplates();
  if (!shipped) return t.skip('git is unavailable, so the tracked template set cannot be read');
  assert.ok(shipped.length >= 8, `expected the shipped template set, found ${shipped.length}`);
  for (const path of shipped) {
    const r = renderLint(path);
    assert.deepEqual(r.findings, [], `${path}: ${JSON.stringify(r.findings)}`);
    assert.equal(r.error, null);
  }
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
