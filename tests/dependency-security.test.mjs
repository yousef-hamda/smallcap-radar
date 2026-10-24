import test from 'node:test';
import assert from 'node:assert/strict';
import braces from 'braces';

test('brace expansion rejects nesting that would overflow recursive AST walks', () => {
  const nested = `${'{'.repeat(500)}x${'}'.repeat(500)}`;
  assert.throws(() => braces.expand(nested), { name: 'SyntaxError', message: /Nesting depth/ });
  const nestedParens = `${'('.repeat(500)}x${')'.repeat(500)}`;
  assert.throws(() => braces.parse(nestedParens), { name: 'SyntaxError', message: /Nesting depth/ });
  assert.deepEqual(braces.expand('{a,b}{1,2}'), ['a1', 'a2', 'b1', 'b2']);
});
