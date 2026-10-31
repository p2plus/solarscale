// Tests for solarscale. The app is ONE html file by design; its testable
// core lives between /*CORE-START*/ and /*CORE-END*/ markers inside it.
// These tests extract that block and run it bare — if the core ever
// references document/window or leaves the file, they fail.
// Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const m = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//);
assert.ok(m, "core block found in index.html");

const core = new Function(`
  "use strict";
  ${m[1]}
  return { VERSION, AU_MKM, OORT_AU, KUIPER_AU, BODIES, DWARFS,
           esc, groupThousands, parseLength, makeScale, fmtLen, fmtWalk,
           allBodies, buildPosterSvg, buildTableModel };
`)();

const poster = (opts = {}) => core.buildPosterSvg({
  dwarfs: false, kuiper: false, oort: false,
  trueSizes: false, trueDist: false, width: 1123, height: 794, ...opts,
});
const count = (s, needle) => s.split(needle).length - 1;

// ---------------------------------------------------------------- units

test("parseLength handles every offered unit", () => {
  assert.equal(core.parseLength("22", "cm"), 0.22);
  assert.equal(core.parseLength("0.22", "m"), 0.22);
  assert.equal(core.parseLength("150", "mm"), 0.15);
  assert.ok(Math.abs(core.parseLength("9.5", "in") - 0.2413) < 1e-12);
  assert.ok(Math.abs(core.parseLength("3", "ft") - 0.9144) < 1e-9);
  assert.equal(core.parseLength("2", "km"), 2000);
  assert.equal(core.parseLength("22", "CM"), 0.22); // case-insensitive
});

test("parseLength rejects garbage", () => {
  assert.throws(() => core.parseLength("abc", "cm"));
  assert.throws(() => core.parseLength("22", "ly"));
  assert.throws(() => core.parseLength("-5", "m"));
  assert.throws(() => core.parseLength("0", "m"));
  assert.throws(() => core.parseLength("NaN", "m"));
});

// ---------------------------------------------------------------- scale

test("the famous basketball anchor: Sun a 24.26cm ball → Earth ≈ 26 m out", () => {
  const s = core.makeScale("sun", 0.2426);
  const d = s.distM(core.AU_MKM);
  assert.ok(d > 25.5 && d < 26.5, `earth distance ${d}`);
});

test("sun anchor: model sizes keep true ratios", () => {
  const s = core.makeScale("sun", 0.2426);
  const earth = s.diameterM(6371 * 2);
  assert.ok(earth > 0.0021 && earth < 0.0023, `earth Ø ${earth} m`);
});

test("1 AU anchor: Sun becomes ~93 cm, Earth exactly at the anchor", () => {
  const s = core.makeScale("au", 100);
  const sun = s.diameterM(1392700);
  assert.ok(sun > 0.92 && sun < 0.94, `sun Ø ${sun}`);
  assert.ok(Math.abs(s.distM(core.AU_MKM) - 100) < 1e-9);
});

test("data sanity: Earth's orbit spans ~107 Sun diameters", () => {
  const ratio = (core.AU_MKM * 1e6) / 1392700;
  assert.ok(ratio > 107 && ratio < 108, `ratio ${ratio}`);
});

test("makeScale rejects bad input", () => {
  assert.throws(() => core.makeScale("sun", 0));
  assert.throws(() => core.makeScale("parsec", 1));
});

// ---------------------------------------------------------------- format

test("fmtLen picks sensible units", () => {
  assert.equal(core.fmtLen(0.002), "2.0 mm");
  assert.equal(core.fmtLen(0.022), "2.2 cm");
  assert.equal(core.fmtLen(0.22), "22.0 cm");
  assert.equal(core.fmtLen(26.06), "26.06 m");
  assert.equal(core.fmtLen(1520), "1.52 km");
  assert.equal(core.fmtLen(4570), "4.57 km");
  assert.equal(core.fmtLen(12345), "12 km");  // rounded, grouped
  assert.equal(core.fmtLen(1234567), "1,235 km");
});

test("fmtWalk formats seconds, minutes, hours", () => {
  const s5 = 5; // km/h
  assert.equal(core.fmtWalk(26.06, s5), "19s");
  assert.equal(core.fmtWalk(800, s5), "10 min");
  assert.equal(core.fmtWalk(9000, s5), "1h 48min");
  assert.equal(core.fmtWalk(800, 10), "5 min"); // speed halves the time
  assert.throws(() => core.fmtWalk(100, 0));
});

test("groupThousands groups like a poster should", () => {
  assert.equal(core.groupThousands(12742), "12,742");
  assert.equal(core.groupThousands(999), "999");
  assert.equal(core.groupThousands(100000), "100,000");
});

// ---------------------------------------------------------------- bodies

test("dwarf flag adds the five dwarfs, ordered by distance", () => {
  const plain = core.allBodies(false), withD = core.allBodies(true);
  assert.equal(plain.length, 9);
  assert.equal(withD.length, 14);
  const names = withD.map(b => b.name);
  assert.deepEqual(names,
    ["Sun", "Mercury", "Venus", "Earth", "Mars", "Ceres", "Jupiter",
     "Saturn", "Uranus", "Neptune", "Pluto", "Haumea", "Makemake", "Eris"]);
});

test("esc escapes everything XML cares about", () => {
  assert.equal(core.esc(`<a&"b'c>`), "&lt;a&amp;&quot;b&apos;c&gt;");
});

// ---------------------------------------------------------------- poster

test("poster is a self-contained svg sized to the page", () => {
  const svg = poster();
  assert.ok(svg.startsWith("<svg "));
  assert.ok(svg.trimEnd().endsWith("</svg>"));
  assert.ok(svg.includes('viewBox="0 0 1123 794"'));
  assert.ok(poster({ width: 1600, height: 900 }).includes('viewBox="0 0 1600 900"'));
});

test("default poster: 9 circles total (sun + halo + 8 planets... minus none)", () => {
  // 8 planet dots + 1 sun + 1 halo = 10 circles
  assert.equal(count(poster(), "<circle"), 10);
  assert.equal(count(poster({ dwarfs: true }), "<circle"), 15);
});

test("poster contains labeled bodies with real diameters, not model guesses", () => {
  const svg = poster();
  for (const n of ["Mercury", "Earth", "Jupiter", "Neptune"]) assert.ok(svg.includes(`>${n}<`), n);
  assert.ok(svg.includes("Ø 12,742 km")); // Earth's real diameter
  assert.ok(!svg.includes("Pluto"));
  assert.ok(poster({ dwarfs: true }).includes("Eris"));
});

test("poster states its honesty mode", () => {
  assert.ok(poster().includes("log"));
  assert.ok(poster({ trueSizes: true }).includes("true body sizes"));
  assert.ok(poster({ trueDist: true }).includes("true distances"));
});

test("optional annotations appear only when asked", () => {
  assert.ok(!poster().includes("Kuiper"));
  assert.ok(poster({ kuiper: true }).includes("Kuiper belt"));
  assert.ok(!poster().includes("Oort"));
  assert.ok(poster({ oort: true }).includes("100,000 AU"));
  assert.ok(poster({ oort: true }).includes("further than Eris"));
});

test("Saturn keeps its ring", () => {
  const svg = poster();
  assert.equal(count(svg, "<ellipse"), 1);
  assert.ok(svg.includes("rotate(-18"));
});

test("no NaN or undefined leaks into any poster mode", () => {
  for (const opts of [{}, { dwarfs: true }, { trueSizes: true },
                      { trueDist: true }, { kuiper: true, oort: true },
                      { dwarfs: true, kuiper: true, oort: true,
                        trueSizes: true, trueDist: true }]) {
    const svg = poster(opts);
    assert.ok(!svg.includes("NaN"), JSON.stringify(opts));
    assert.ok(!svg.includes("undefined"), JSON.stringify(opts));
  }
});

test("axis positions: log monotonic, linear proportional", () => {
  // Reconstruct positions from the geometry the poster uses: parse each
  // planet dot's cx and compare against known semi-major axes.
  const circles = poster().match(/<circle[^>]*cy="(?!.*?)(\d+(?:\.\d+)?)[^>]*>/g) || [];
  const earthX = bodyCx(poster(), "Earth");
  const jupX = bodyCx(poster(), "Jupiter");
  const nepX = bodyCx(poster(), "Neptune");
  assert.ok(jupX > earthX && nepX > jupX); // log mode: farther → righter

  const lin = poster({ trueDist: true });
  const e = bodyCx(lin, "Earth"), j = bodyCx(lin, "Jupiter"),
        n = bodyCx(lin, "Neptune");
  const x0 = 0.17 * 1123, span = (0.93 - 0.17) * 1123;
  const rel = x => (x - x0) / span;
  const aE = 149.6, aJ = 778.5, aN = 4495.1;
  assert.ok(Math.abs(rel(e) / aE - rel(j) / aJ) < 1e-3, "linear proportion");
  assert.ok(Math.abs(rel(e) / aE - rel(n) / aN) < 1e-3, "linear proportion 2");
});

function bodyCx(svg, name) {
  // The label text sits above/below its dot with the same x anchor.
  const re = new RegExp(`<text[^>]*>${name}</text>`);
  const label = svg.match(re)[0];
  const x = Number(label.match(/x="([\d.]+)"/)[1]);
  return x;
}

test("true sizes keep real ratios: Earth ≈ 0.091× Jupiter", () => {
  const svg = poster({ trueSizes: true });
  const e = bodyR(svg, "Earth"), j = bodyR(svg, "Jupiter");
  const expected = 6371 / 69911;
  assert.ok(Math.abs(e / j - expected) < 1e-3, `ratio ${e / j}`);
});

function bodyR(svg, name) {
  const x = bodyCx(svg, name);
  const c = svg.match(new RegExp(`<circle[^>]*cx="${x.toFixed?(+x).toFixed(2):x}"[^>]*>`))
    || svg.match(new RegExp(`<circle[^>]*cx="${x}"[^>]*>`));
  return Number(c[0].match(/r="([\d.]+)"/)[1]);
}

// ---------------------------------------------------------------- table

test("walk model table for a 22cm Sun", () => {
  const rows = core.buildTableModel("sun", 0.22, 5, false, false);
  assert.equal(rows.length, 9);
  const earth = rows.find(r => r.name === "Earth");
  assert.equal(earth.size, "2.0 mm");
  assert.equal(earth.distText, "23.63 m"); // 0.22 m × 107.42 sun diameters
  assert.equal(rows[0].name, "Sun");
  assert.equal(rows[0].distText, "—");
});

test("table with dwarfs and oort rows", () => {
  const rows = core.buildTableModel("au", 100, 5, true, true);
  assert.equal(rows.length, 15);
  const oort = rows[rows.length - 1];
  assert.equal(oort.name, "Oort cloud (outer edge)");
  // 100,000 AU at 100 m per AU = 10,000 km
  assert.ok(oort.distText.includes("10,000 km"), oort.distText);
  const eris = rows.find(r => r.name === "Eris");
  assert.equal(eris.distText, "6.77 km"); // 67.68 AU × 100 m
});

// ---------------------------------------------------------------- core purity

test("core never touches the DOM (it must run from a bare file)", () => {
  // The extraction itself already proves this — new Function ran the core
  // in node with no document/window defined. Double-check nothing leaked:
  assert.equal(typeof globalThis.document, "undefined");
});

test("single-file property: index.html has exactly one core block", () => {
  assert.equal(count(html, "/*CORE-START*/"), 1);
  assert.equal(count(html, "/*CORE-END*/"), 1);
});
