import { test } from 'node:test';
import assert from 'node:assert/strict';
import { funnyName, nickColor, NAME_ADJ, NAME_FOOD } from '../../web/js/shared/names.js';
test('names are unique within a table even when many people join', () => { const taken = []; for (let i = 0; i < 60; i++) { const n = funnyName(taken).nick; assert.ok(!taken.includes(n), n); taken.push(n); } });
test('falls back to a numbered name when the pool is exhausted', () => { const all = NAME_ADJ.flatMap(a => NAME_FOOD.map(([f]) => `${a} ${f}`)); assert.match(funnyName(all).nick, /^Mystery .+ \d{3}$/); });
test('every name has an emoji and a stable colour', () => { const n = funnyName([]); assert.ok(n.emoji); assert.equal(nickColor(n.nick), nickColor(n.nick)); });
