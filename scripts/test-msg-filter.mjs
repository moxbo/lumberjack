#!/usr/bin/env node
import { msgMatches } from '../src/utils/msgFilter.mjs';

function expect(msg, expr, expected) {
  const got = msgMatches(msg, expr);
  const ok = got === expected;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  expr=${JSON.stringify(expr)}  msg=${JSON.stringify(msg)}  -> ${got}`
  );
  if (!ok) return 1;
  return 0;
}

let fails = 0;
fails += expect('foo bar', '', true);
fails += expect('foo bar', 'foo', true);
fails += expect('foo bar', 'bar', true);
fails += expect('foo bar', 'baz', false);

fails += expect('foo bar', 'foo&bar', true);
fails += expect('bar foo', 'foo&bar', true);
fails += expect('foo bar', 'foo|baz', true);
fails += expect('foo bar', 'baz|qux', false);

// Negation (!)
fails += expect('foo bar', 'foo&!bar', false);
fails += expect('foo qux', 'foo&!bar', true);

// Beispiel aus der Anforderung
fails += expect('QcStatus done CB23', 'QcStatus&!CB23', false);
fails += expect('QcStatus okay', 'QcStatus&!CB23', true);

// Doppelte Negation
fails += expect('lorem foo ipsum', '!!foo', true);

if (fails) {
  console.error(`Tests failed: ${fails}`);
  process.exit(1);
} else {
  console.log('All tests passed.');
}
