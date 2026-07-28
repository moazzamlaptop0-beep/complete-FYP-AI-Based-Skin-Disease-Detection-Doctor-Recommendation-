/**
 * The safety rules for the result screen's advice, as tests.
 *
 * This module is the only place in the app that tells a patient what to DO, and
 * it does it without any clinical data behind it: the backend returns a class
 * label, a confidence and a severity, and nothing else. So the rules it has to
 * obey are not style preferences, and they are asserted here rather than left in
 * a comment:
 *
 *   1. Every band answers with all three lists filled in. A card that renders an
 *      empty <ul> is worse than no card.
 *   2. A missing or unrecognised severity falls back to a COMPLETE entry that
 *      does not pretend to be a band and does not read as reassurance.
 *   3. No drug name, product form, dosage or clinical procedure anywhere. The
 *      moment a name appears the app is prescribing, which it is not licensed,
 *      qualified or informed enough to do.
 *   4. No em-dash and no double hyphen in anything a patient reads.
 */

import { describe, expect, it } from 'vitest';

import {
  GENERAL_INFO_LABEL,
  GENERAL_INFO_NOTE,
  PANEL_TITLES,
  RECOMMENDATIONS,
  SEVERITY_ORDER,
  UNKNOWN_SEVERITY,
  diseaseTierNote,
  normalizeSeverity,
  recommendationsFor,
  replyWindowText,
} from '../recommendations';

/** The three lists, as one flat array. */
function listsOf(entry) {
  return [...entry.nextSteps, ...entry.selfCare, ...entry.redFlags];
}

/** Every string a patient could read on the entry. */
function proseOf(entry) {
  return [entry.timeframe, entry.headline, entry.summary, ...listsOf(entry)];
}

/**
 * Drug names, drug CLASSES, product forms and dosage units. Word-bounded so
 * "gently" cannot trip "gel" and "spilling" cannot trip "pill".
 *
 * `prescription` is deliberately absent: the disclaimer says the content is
 * "not a prescription", which is the opposite of the problem being guarded.
 */
const FORBIDDEN = [
  'steroid', 'steroids', 'corticosteroid', 'hydrocortisone', 'betamethasone', 'clobetasol',
  'antibiotic', 'antibiotics', 'antihistamine', 'antihistamines', 'antifungal', 'antifungals',
  'antiseptic', 'antiviral',
  'clotrimazole', 'terbinafine', 'ketoconazole', 'miconazole', 'permethrin',
  'benzoyl', 'salicylic', 'tretinoin', 'isotretinoin', 'retinoid', 'retinol',
  'ibuprofen', 'paracetamol', 'acetaminophen', 'aspirin', 'prednisone', 'prednisolone',
  'methotrexate', 'tacrolimus', 'calcipotriol', 'calamine', 'aloe', 'iodine',
  'cream', 'creams', 'ointment', 'ointments', 'lotion', 'lotions', 'balm', 'gel',
  'tablet', 'tablets', 'capsule', 'capsules', 'pill', 'pills', 'injection', 'injections',
  'dose', 'doses', 'dosage', 'mg', 'ml', 'twice daily', 'biopsy', 'freeze off', 'cauterise',
];

const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN.join('|')})\\b`, 'i');

/** All four entries: the three bands plus the fallback. */
const EVERY_ENTRY = Object.values(RECOMMENDATIONS);

describe('recommendationsFor', () => {
  it('covers every severity the triage engine can return', () => {
    expect(SEVERITY_ORDER).toEqual(['CRITICAL', 'URGENT', 'ROUTINE']);
    SEVERITY_ORDER.forEach((key) => {
      expect(RECOMMENDATIONS[key], `${key} has no curated content`).toBeTruthy();
      expect(recommendationsFor(key).key).toBe(key);
    });
  });

  it('answers every severity with all three lists filled in', () => {
    SEVERITY_ORDER.forEach((key) => {
      const entry = recommendationsFor(key);
      expect(entry.nextSteps.length, `${key} next steps`).toBeGreaterThan(0);
      expect(entry.selfCare.length, `${key} self-care`).toBeGreaterThan(0);
      expect(entry.redFlags.length, `${key} red flags`).toBeGreaterThan(0);
      expect(entry.headline.length).toBeGreaterThan(0);
      expect(entry.timeframe.length).toBeGreaterThan(0);
      expect(entry.known).toBe(true);
      // Every item is a non-empty, trimmed sentence.
      listsOf(entry).forEach((item) => {
        expect(typeof item).toBe('string');
        expect(item.trim()).toBe(item);
        expect(item.length).toBeGreaterThan(10);
      });
    });
  });

  it('matches a severity whatever case or padding it arrives in', () => {
    expect(recommendationsFor('critical').key).toBe('CRITICAL');
    expect(recommendationsFor(' Urgent ').key).toBe('URGENT');
    expect(recommendationsFor('routine').key).toBe('ROUTINE');
    expect(normalizeSeverity('CrItIcAl')).toBe('CRITICAL');
    expect(normalizeSeverity('emergency')).toBeNull();
    expect(normalizeSeverity(null)).toBeNull();
  });

  it('escalates: critical is soonest, routine is latest', () => {
    expect(recommendationsFor('CRITICAL').tone).toBe('danger');
    expect(recommendationsFor('URGENT').tone).toBe('warning');
    expect(recommendationsFor('ROUTINE').tone).toBe('success');
    expect(recommendationsFor('CRITICAL').nextSteps.join(' ')).toMatch(/today/i);
    expect(recommendationsFor('URGENT').nextSteps.join(' ')).toMatch(/48 hours/i);
  });
});

describe('a missing or unrecognised severity falls back safely', () => {
  const cases = [undefined, null, '', '   ', 0, false, 'banana', 'HIGH', { severity: 'URGENT' }, []];

  it('never returns null or an empty entry', () => {
    cases.forEach((value) => {
      const entry = recommendationsFor(value);
      expect(entry, String(value)).toBeTruthy();
      expect(entry.key).toBe(UNKNOWN_SEVERITY);
      expect(entry.nextSteps.length).toBeGreaterThan(0);
      expect(entry.selfCare.length).toBeGreaterThan(0);
      expect(entry.redFlags.length).toBeGreaterThan(0);
    });
  });

  it('does not pretend to be a band, and does not read as reassurance', () => {
    const entry = recommendationsFor(undefined);
    // Flagged as unknown, so the UI can label it honestly...
    expect(entry.known).toBe(false);
    expect(SEVERITY_ORDER).not.toContain(entry.key);
    // ...and it is NOT quietly the routine content, which would downgrade an
    // unscored scan to "no rush" on the strength of a failed network call.
    expect(entry).not.toBe(RECOMMENDATIONS.ROUTINE);
    expect(entry.nextSteps.join(' ')).toMatch(/dermatologist/i);
    expect(entry.summary).toMatch(/no severity/i);
  });
});

describe('nothing here prescribes anything', () => {
  it('names no drug, product form, dosage or procedure', () => {
    EVERY_ENTRY.forEach((entry) => {
      proseOf(entry).forEach((text) => {
        const hit = text.match(FORBIDDEN_RE);
        expect(hit, `"${text}" mentions "${hit?.[0]}"`).toBeNull();
      });
    });
  });

  it('labels every panel as general information', () => {
    expect(GENERAL_INFO_LABEL).toBeTruthy();
    expect(GENERAL_INFO_NOTE).toMatch(/not a diagnosis/i);
    expect(GENERAL_INFO_NOTE).toMatch(/not a prescription/i);
    expect(Object.keys(PANEL_TITLES).sort()).toEqual(['nextSteps', 'redFlags', 'selfCare']);
    Object.values(PANEL_TITLES).forEach((title) => expect(title.length).toBeGreaterThan(0));
  });

  it('keys the advice on severity, never on a predicted disease', () => {
    // A disease name in this module would mean the app had started diagnosing.
    const diseases = /melanoma|carcinoma|eczema|psoriasis|nevi|keratos|ringworm|dermatitis/i;
    EVERY_ENTRY.forEach((entry) => {
      proseOf(entry).forEach((text) => expect(text).not.toMatch(diseases));
    });
  });
});

describe('the copy rule (no em-dash, no double hyphen)', () => {
  const forbiddenPunctuation = /—|--/;

  it('holds for every curated string', () => {
    EVERY_ENTRY.forEach((entry) => {
      proseOf(entry).forEach((text) => expect(text).not.toMatch(forbiddenPunctuation));
    });
    [GENERAL_INFO_LABEL, GENERAL_INFO_NOTE, ...Object.values(PANEL_TITLES)].forEach((text) => {
      expect(text).not.toMatch(forbiddenPunctuation);
    });
  });

  it('holds for the generated sentences too', () => {
    [
      replyWindowText(4, { express: true }),
      replyWindowText(72),
      replyWindowText(1, { express: true }),
      diseaseTierNote('CRITICAL'),
      diseaseTierNote('ROUTINE', false),
    ].forEach((text) => {
      expect(text).toBeTruthy();
      expect(text).not.toMatch(forbiddenPunctuation);
    });
  });
});

describe('replyWindowText', () => {
  it('turns expires_in_hours into a deadline a person can act on', () => {
    expect(replyWindowText(4, { express: true }))
      .toBe('A doctor has about 4 hours to respond on the fast lane.');
    expect(replyWindowText(1, { express: true })).toMatch(/about 1 hour to respond/);
    expect(replyWindowText(72)).toMatch(/about 3 days to respond/);
    expect(replyWindowText(24)).toMatch(/about 1 day to respond/);
  });

  it('returns null rather than inventing a deadline', () => {
    [undefined, null, '', 'soon', 0, -5, Number.NaN, Infinity].forEach((value) => {
      expect(replyWindowText(value), String(value)).toBeNull();
    });
  });
});

describe('diseaseTierNote', () => {
  it('explains the tier the condition carries on its own', () => {
    expect(diseaseTierNote('URGENT', true)).toMatch(/rated urgent/);
    expect(diseaseTierNote('critical')).toMatch(/rated critical/);
  });

  it('says so when the condition is not in the triage table', () => {
    const note = diseaseTierNote('ROUTINE', false);
    expect(note).toMatch(/not in the triage table/i);
    // The backend falls back to ROUTINE for an unmapped class, so the note must
    // not present that fallback as a finding about the condition.
    expect(note).not.toMatch(/rated routine/);
  });

  it('returns null for a tier it does not recognise', () => {
    [undefined, null, '', 'MEDIUM', 5].forEach((value) => {
      expect(diseaseTierNote(value), String(value)).toBeNull();
    });
  });
});
