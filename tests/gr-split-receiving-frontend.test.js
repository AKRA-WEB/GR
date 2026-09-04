const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const assert = require('assert');

console.log('=== TESTING GR SPLIT RECEIVING FRONTEND CONTRACT ===\n');

const htmlPath = path.join(__dirname, '../index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 1. Compile inline script
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let mainScript = '';
while ((match = scriptRegex.exec(html)) !== null) {
    const code = match[1].trim();
    if (code.includes('CURRENT_VERSION')) {
        mainScript = code;
    }
}
assert.ok(mainScript.length > 0, 'Must extract main script');

class MockElement {
    constructor(id = '', tag = 'div') {
        this.id = id;
        this.tagName = tag;
        this.innerHTML = '';
        this.innerText = '';
        this.value = '';
        this.classList = {
            toggle: () => false,
            add: () => {},
            remove: () => {},
            contains: () => false
        };
        this.style = {};
        this.children = [];
    }
    querySelector() { return new MockElement(); }
    querySelectorAll() { return []; }
    closest() { return new MockElement(); }
    addEventListener() {}
    setAttribute() {}
    getAttribute() { return ''; }
}

const elements = new Map();
function getEl(id) {
    if (!elements.has(id)) elements.set(id, new MockElement(id));
    return elements.get(id);
}

const context = {
    console,
    window: {
        location: { search: '' },
        addEventListener: () => {},
        matchMedia: () => ({ matches: false, addEventListener: () => {} })
    },
    document: {
        getElementById: getEl,
        querySelector: () => new MockElement(),
        querySelectorAll: () => [],
        addEventListener: () => {},
        body: new MockElement('body', 'body')
    },
    navigator: { onLine: true },
    fetch: async () => ({ ok: true, json: async () => ({ version: '20260904.03' }) }),
    URLSearchParams: global.URLSearchParams,
    Date: global.Date,
    parseFloat: global.parseFloat,
    String: global.String,
    Boolean: global.Boolean,
    Array: global.Array,
    Object: global.Object
};
vm.createContext(context);
vm.runInContext(mainScript, context);

// Test parseSplitLoc
assert.strictEqual(typeof context.parseSplitLoc, 'function', 'parseSplitLoc must be defined');

const split1 = context.parseSplitLoc('W1-1F-Z1 (90 ลัง) | W5-1F-Z2 (10 ลัง)');
assert.ok(split1, 'Should parse split string');
assert.strictEqual(split1.loc1.wh, 'W1');
assert.strictEqual(split1.loc1.floor, '1');
assert.strictEqual(split1.loc1.zone, 'Z1');
assert.strictEqual(split1.qty1, '90');
assert.strictEqual(split1.loc2.wh, 'W5');
assert.strictEqual(split1.loc2.floor, '1');
assert.strictEqual(split1.loc2.zone, 'Z2');
assert.strictEqual(split1.qty2, '10');
console.log('[PASS] 1. parseSplitLoc correctly parsed structured loc & qty for both warehouses');

const split2 = context.parseSplitLoc('W5-2F (40) | W1-1F-A (60)');
assert.strictEqual(split2.loc1.wh, 'W5');
assert.strictEqual(split2.loc1.floor, '2');
assert.strictEqual(split2.loc1.zone, '');
assert.strictEqual(split2.qty1, '40');
assert.strictEqual(split2.loc2.wh, 'W1');
assert.strictEqual(split2.loc2.floor, '1');
assert.strictEqual(split2.loc2.zone, 'A');
assert.strictEqual(split2.qty2, '60');
console.log('[PASS] 2. parseSplitLoc parsed zoneless location and simple numbers');

const nonSplit = context.parseSplitLoc('W1-1F-Z1');
assert.strictEqual(nonSplit, null, 'Non-split string must return null');
console.log('[PASS] 3. parseSplitLoc returns null for standard non-split location');

// Test serialization pattern
const loc1 = context.serializeLoc('W1', '1', 'Z1');
const loc2 = context.serializeLoc('W5', '1', 'Z2');
const q1 = 90;
const q2 = 10;
const unit = 'ลัง';
const uStr = unit ? ` ${unit}` : '';
const serialized = `${loc1} (${q1}${uStr}) | ${loc2} (${q2}${uStr})`;
assert.strictEqual(serialized, 'W1-1F-Z1 (90 ลัง) | W5-1F-Z2 (10 ลัง)');
console.log('[PASS] 4. Serialized format matches contract: ' + serialized);

console.log('\n🌟 ALL GR SPLIT FRONTEND TESTS PASSED (100%)! 🌟');
