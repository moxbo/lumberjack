#!/usr/bin/env node
import { msgMatches } from '../src/utils/msgFilter';

function expect(msg: string, expr: string, expected: boolean): number {
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

// Beispiel aus der Anforderung mit Klammern
fails += expect('xml foo AGV', 'xml&(CB|AGV)', true); // xml und (AGV oder CB)
fails += expect('xml foo CB', 'xml&(CB|AGV)', true);
fails += expect('xml foo', 'xml&(CB|AGV)', false);
fails += expect('bar AGV', 'xml&(CB|AGV)', false);

// Klammern mit Negation
fails += expect('xml CB', 'xml&!(CB|AGV)', false);
fails += expect('xml X', 'xml&!(CB|AGV)', true);

// Verschachtelung und Priorität
fails += expect('a b c', 'a&(b|c)', true);
fails += expect('a x c', 'a&(b|c)', true);
fails += expect('a x y', 'a&(b|c)', false);
fails += expect('a b c', 'a|b&c', true); // & hat Vorrang vor |
fails += expect('b c', 'a|b&c', true);
fails += expect('b x', 'a|b&c', false);

if (fails) {
  console.error(`Tests failed: ${fails}`);
  process.exit(1);
} else {
  console.log('All tests passed.');
}
