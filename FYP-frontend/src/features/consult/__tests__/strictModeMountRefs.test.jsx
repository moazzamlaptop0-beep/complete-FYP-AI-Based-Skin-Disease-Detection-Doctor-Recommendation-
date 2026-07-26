/**
 * Regression: hooks that gate setState on a "still mounted" ref must RE-ARM
 * that ref on mount.
 *
 * THE BUG THIS PINS DOWN, reported from a real browser: "scan is not working,
 * stuck at cropping."
 *
 * The pattern that caused it, repeated in five hooks across the app:
 *
 *     const mounted = useRef(true);
 *     useEffect(() => () => { mounted.current = false; }, []);
 *
 * It looks airtight, and it is — for exactly one mount. React StrictMode
 * mounts, unmounts and remounts every component in development, so the cleanup
 * fires once and leaves the ref false for the rest of the session. `useRef`'s
 * initial value is only applied on the FIRST mount, so nothing ever sets it
 * back. Every `if (!mounted.current) return;` guard then fires on the happy
 * path: in StepCapture the crop finished, was revoked, and was thrown away
 * while the button sat on "Cropping…" forever.
 *
 * These tests assert the SHAPE of the fix rather than driving the UI, because
 * the failure is invisible to a normal render test — which is precisely why
 * 169 passing tests said nothing about it. `useAuthMachine.test.jsx` covers the
 * behavioural half by running the real machine under StrictMode.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../..');

/** Every .js/.jsx under src/, excluding tests. */
function sourceFiles(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') sourceFiles(full, out);
    } else if (/\.jsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Effects written as `useEffect(() => () => {...}, [])` — a cleanup with no body,
 *  so a ref disarmed inside it can never be re-armed. */
const ARROW_CLEANUP = /useEffect\(\(\)\s*=>\s*\(\)\s*=>\s*\{(.*?)\}\s*,\s*\[\]\)/gs;

/** Effects with a body, so we can check the body re-arms whatever it disarms. */
const BODY_EFFECT = /useEffect\(\(\)\s*=>\s*\{(.*?)\n {2}\}\s*,\s*\[\]\)/gs;

describe('StrictMode-safe mount refs', () => {
  const files = sourceFiles();

  it('finds source files to scan (guards against a broken glob)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no mount-once effect disarms a ref it cannot re-arm', () => {
    const offenders = [];

    for (const file of files) {
      const code = fs.readFileSync(file, 'utf8');
      const rel = path.relative(SRC, file);

      for (const match of code.matchAll(ARROW_CLEANUP)) {
        if (match[1].includes('.current = false')) {
          offenders.push(
            `${rel}: uses "useEffect(() => () => {...}, [])" to set a ref false. `
            + 'It has no effect body, so the ref stays false after StrictMode remounts. '
            + 'Write "useEffect(() => { ref.current = true; return () => { ref.current = false; }; }, [])".',
          );
        }
      }

      for (const match of code.matchAll(BODY_EFFECT)) {
        const body = match[1];
        const disarmed = new Set([...body.matchAll(/(\w+)\.current = false/g)].map((m) => m[1]));
        for (const ref of disarmed) {
          if (!body.includes(`${ref}.current = true`)) {
            offenders.push(
              `${rel}: "${ref}.current" is set false in a cleanup but never re-armed in the `
              + 'effect body, so it stays false after StrictMode remounts.',
            );
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the five hooks that hit this bug are all fixed', () => {
    // Named explicitly so deleting the generic scan above cannot quietly drop
    // coverage of the exact files that broke sign-in and the scan flow.
    const fixed = [
      'features/auth/useAuthMachine.js',
      'features/auth/useConsentDocuments.js',
      'features/consult/ConsultContext.jsx',
      'features/consult/steps/StepCapture.jsx',
      'features/consult/hooks/useMultiSlots.js',
      'features/consult/hooks/useDoctorDirectory.js',
    ];

    for (const rel of fixed) {
      const code = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect(code, `${rel} should re-arm its mount ref`).toMatch(/\.current = true;/);
    }
  });
});
