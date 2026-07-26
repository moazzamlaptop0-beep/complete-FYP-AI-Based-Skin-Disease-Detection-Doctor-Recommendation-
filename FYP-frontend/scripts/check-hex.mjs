#!/usr/bin/env node
/**
 * ============================================================================
 *  check-hex — raw brand-hex census
 * ============================================================================
 *  The design system exists to delete ~240 hard-coded brand hex literals from
 *  src/. This script counts what is left, so the token migration in the next
 *  phases has a measurable finish line instead of a vibe.
 *
 *  Usage:
 *    node scripts/check-hex.mjs              # report
 *    node scripts/check-hex.mjs --by-file    # per-file breakdown
 *    node scripts/check-hex.mjs --max 120    # exit 1 if the count exceeds 120
 *    node scripts/check-hex.mjs --json       # machine-readable
 *
 *  Wire `--max` into CI once the migration starts, ratcheting the number down.
 * ============================================================================
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

/** Files that legitimately contain the brand hex: the token definitions. */
const ALLOWLIST = [
  'src/styles/tokens.css', // the single source of truth — hex belongs here
];

const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.html']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '__snapshots__']);

/**
 * Brand colours we are migrating away from. `label` is what the offending hex
 * should become once the page is ported.
 */
const BRAND_HEXES = [
  { hex: '0c2b5e', token: 'primary-900 / bg-primary-900', note: 'brand navy' },
  { hex: '081d42', token: 'primary-950', note: 'brand navy hover' },
  { hex: '3fd5c2', token: 'accent-400 (fills) / accent-700 (text)', note: 'brand teal' },
  { hex: '2bb8a5', token: 'accent-500', note: 'teal hover' },
  { hex: '0f6e56', token: 'accent-700', note: 'AA teal text' },
];

const hexAlternation = BRAND_HEXES.map((b) => b.hex).join('|');
/** Matches `#0c2b5e`, `0c2b5e`, `#0C2B5E` — with or without the `#`. */
const BRAND_RE = new RegExp(`#?(${hexAlternation})\\b`, 'gi');
/** Any 3/6/8-digit hex literal, for the wider "no raw colour at all" number. */
const ANY_HEX_RE = /#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (EXTENSIONS.has(extname(entry.name))) {
      yield full;
    }
  }
}

function toPosix(p) {
  return p.split('\\').join('/');
}

async function main() {
  const args = process.argv.slice(2);
  const byFile = args.includes('--by-file');
  const asJson = args.includes('--json');
  const maxIndex = args.indexOf('--max');
  const max = maxIndex !== -1 ? Number(args[maxIndex + 1]) : null;

  const files = [];
  const perHex = Object.fromEntries(BRAND_HEXES.map((b) => [b.hex, 0]));
  let brandTotal = 0;
  let anyHexTotal = 0;

  for await (const file of walk(SRC)) {
    const rel = toPosix(relative(ROOT, file));
    if (ALLOWLIST.includes(rel)) continue;

    const source = await readFile(file, 'utf8');
    const brandMatches = source.match(BRAND_RE) ?? [];
    const anyMatches = source.match(ANY_HEX_RE) ?? [];

    anyHexTotal += anyMatches.length;
    if (!brandMatches.length) continue;

    for (const match of brandMatches) {
      const key = match.replace('#', '').toLowerCase();
      if (key in perHex) perHex[key] += 1;
    }
    brandTotal += brandMatches.length;

    // Line-accurate list so the migration can be done file by file.
    const lines = [];
    source.split(/\r?\n/).forEach((line, i) => {
      const hits = line.match(BRAND_RE);
      if (hits) lines.push({ line: i + 1, count: hits.length, text: line.trim().slice(0, 120) });
    });

    files.push({ file: rel, count: brandMatches.length, lines });
  }

  files.sort((a, b) => b.count - a.count);

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ brandTotal, anyHexTotal, perHex, files: files.map(({ file, count }) => ({ file, count })) }, null, 2)}\n`,
    );
  } else {
    const bar = '─'.repeat(64);
    console.log(`\n${bar}`);
    console.log('  RAW BRAND HEX CENSUS  (src/, excluding styles/tokens.css)');
    console.log(bar);

    for (const brand of BRAND_HEXES) {
      const count = perHex[brand.hex];
      const flag = count > 0 ? ' ' : '✓';
      console.log(
        `${flag} #${brand.hex}  ${String(count).padStart(4)}  ${brand.note.padEnd(16)} -> ${brand.token}`,
      );
    }

    console.log(bar);
    console.log(`  BRAND HEX LITERALS REMAINING : ${brandTotal}`);
    console.log(`  ANY hex literal in src/      : ${anyHexTotal}`);
    console.log(`  Files affected               : ${files.length}`);
    console.log(bar);

    if (byFile) {
      console.log('\n  Per file (highest first):\n');
      for (const entry of files) {
        console.log(`  ${String(entry.count).padStart(4)}  ${entry.file}`);
        for (const line of entry.lines.slice(0, 3)) {
          console.log(`        L${line.line}: ${line.text}`);
        }
        if (entry.lines.length > 3) console.log(`        … ${entry.lines.length - 3} more line(s)`);
      }
      console.log('');
    } else if (files.length) {
      console.log('\n  Top offenders:\n');
      for (const entry of files.slice(0, 12)) {
        console.log(`  ${String(entry.count).padStart(4)}  ${entry.file}`);
      }
      if (files.length > 12) console.log(`        … and ${files.length - 12} more file(s)`);
      console.log('\n  Run with --by-file for line numbers.\n');
    } else {
      console.log('\n  🎉 Zero raw brand hex literals left. Migration complete.\n');
    }
  }

  if (max != null && Number.isFinite(max) && brandTotal > max) {
    console.error(
      `\n  ✗ FAIL: ${brandTotal} brand hex literals exceeds the --max budget of ${max}.\n`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
