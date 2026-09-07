const assert = require('node:assert/strict');
const GrExpiry = require('../js/gr-expiry.js');

console.log('--- Testing GR Expiry Frontend Normalization & Ambiguity Resolution ---');

// AC1: Various separators and ISO format
console.log('Testing AC1: Common human formats and separators...');
const ac1Cases = [
  '31/12/2026',
  '31-12-2026',
  '31.12.2026',
  '31 12 2026',
  '2026-12-31',
  '2026/12/31',
  '2026.12.31'
];
for (const input of ac1Cases) {
  const res = GrExpiry.parseExpiryInput(input);
  assert.strictEqual(res.valid, true, `Expected valid for "${input}"`);
  assert.strictEqual(res.iso, '2026-12-31', `Expected 2026-12-31 for "${input}", got ${res.iso}`);
  assert.ok(res.previewText.includes('31 ธันวาคม 2569'), `Expected Thai preview for "${input}"`);
}
console.log('✓ AC1 Passed: All common human formats and separators normalize to 2026-12-31');

// AC2: Buddhist era, Thai digits, Thai/English months
console.log('Testing AC2: Buddhist era, Thai numerals, Thai and English month names...');
const ac2Cases = [
  { in: '31/12/2569', exp: '2026-12-31' },
  { in: '๓๑/๑๒/๒๕๖๙', exp: '2026-12-31' },
  { in: '31 ธันวาคม 2569', exp: '2026-12-31' },
  { in: '31 ธ.ค. 2569', exp: '2026-12-31' },
  { in: '31 ธ.ค. 69', exp: '2026-12-31' }, // Thai month + 2-digit year is BE
  { in: '31 Dec 2026', exp: '2026-12-31' },
  { in: 'December 31, 2026', exp: '2026-12-31' },
  { in: '1 มกราคม 2570', exp: '2027-01-01' },
  { in: '15 พ.ย. 69', exp: '2026-11-15' }
];
for (const c of ac2Cases) {
  const res = GrExpiry.parseExpiryInput(c.in);
  assert.strictEqual(res.valid, true, `Expected valid for "${c.in}"`);
  assert.strictEqual(res.iso, c.exp, `Expected ${c.exp} for "${c.in}", got ${res.iso}`);
}
console.log('✓ AC2 Passed: Buddhist era, Thai digits, and month names normalize correctly');

// AC3: Ambiguity handling with candidate choices
console.log('Testing AC3: Short year ambiguity and candidate generation...');
const ac3Cases = [
  '31/12/69',
  '31/12/26',
  '03/04/26',
  '15/06/25'
];
for (const input of ac3Cases) {
  const res = GrExpiry.parseExpiryInput(input);
  assert.strictEqual(res.valid, false, `Expected ambiguous (not immediately valid) for "${input}"`);
  assert.strictEqual(res.ambiguous, true, `Expected ambiguous=true for "${input}"`);
  assert.ok(res.candidates.length >= 2, `Expected at least 2 candidates for "${input}"`);
  // All candidates must have valid ISO dates
  for (const cand of res.candidates) {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(cand.iso), `Candidate iso invalid: ${cand.iso}`);
    assert.ok(cand.label, 'Candidate must have descriptive label');
    assert.ok(cand.preview, 'Candidate must have Thai preview');
  }
}
// Specifically verify 31/12/69 has candidate BE 2569 -> CE 2026
const res69 = GrExpiry.parseExpiryInput('31/12/69');
const be2569 = res69.candidates.find(c => c.iso === '2026-12-31');
assert.ok(be2569, 'Must offer 2026-12-31 (BE 2569) as candidate for 31/12/69');
assert.ok(be2569.label.includes('2569'));
console.log('✓ AC3 Passed: Ambiguous 2-digit years offer labeled candidates with explicit BE/CE choices');

// AC4: Incomplete and impossible dates
console.log('Testing AC4: Incomplete and impossible dates...');
const ac4Incomplete = ['12/2026', '2026', '12/2569', '09/2027'];
for (const input of ac4Incomplete) {
  const res = GrExpiry.parseExpiryInput(input);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.incomplete, true, `Expected incomplete=true for "${input}"`);
  assert.ok(res.error.includes('ระบุวัน'), `Expected missing day error for "${input}"`);
}

const ac4Invalid = [
  '31/02/2026',
  '31/04/2026',
  '31/06/2026',
  '31/09/2026',
  '31/11/2026',
  '00/12/2026',
  '32/01/2026',
  '15/13/2026',
  'nonsense text',
  'abc-def'
];
for (const input of ac4Invalid) {
  const res = GrExpiry.parseExpiryInput(input);
  assert.strictEqual(res.valid, false, `Expected invalid for "${input}"`);
  assert.ok(res.error, `Expected error message for "${input}"`);
}
console.log('✓ AC4 Passed: Incomplete and impossible calendar dates correctly rejected with friendly messages');

// AC5: Optional blanks, whitespace, leap year handling
console.log('Testing AC5: Blank optional values and leap years...');
assert.strictEqual(GrExpiry.parseExpiryInput('').isEmpty, true);
assert.strictEqual(GrExpiry.parseExpiryInput('   ').isEmpty, true);
assert.strictEqual(GrExpiry.parseExpiryInput(null).isEmpty, true);
assert.strictEqual(GrExpiry.parseExpiryInput(undefined).isEmpty, true);

// Leap year 2028: 29 Feb is valid
const leap2028 = GrExpiry.parseExpiryInput('29/02/2028');
assert.strictEqual(leap2028.valid, true);
assert.strictEqual(leap2028.iso, '2028-02-29');

// Non-leap year 2026: 29 Feb is invalid
const nonLeap2026 = GrExpiry.parseExpiryInput('29/02/2026');
assert.strictEqual(nonLeap2026.valid, false);
assert.ok(nonLeap2026.error.includes('28 วัน'));
console.log('✓ AC5 Passed: Blank values remain optional; leap days correctly preserved or rejected');

console.log('\n=============================================');
console.log('✓ ALL GR FRONTEND EXPIRY UNIT TESTS PASSED!');
console.log('=============================================');
