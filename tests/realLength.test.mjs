import test from 'node:test';
import assert from 'node:assert/strict';
import { paperLengthWords, parseRealLength } from '../src/utils/measure/realLength.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('feet and inches in every way plans write them', () => {
  near(parseRealLength("20'", 'ft'), 20);
  near(parseRealLength("20' 6\"", 'ft'), 20.5);
  near(parseRealLength("20'-6\"", 'ft'), 20.5);
  near(parseRealLength("20'6", 'ft'), 20.5);
  near(parseRealLength('20-6', 'ft'), 20.5);
  near(parseRealLength('20 ft 6 in', 'ft'), 20.5);
  near(parseRealLength('6"', 'ft'), 0.5);
  near(parseRealLength('12 1/2"', 'in'), 12.5);
  near(parseRealLength('3/4"', 'in'), 0.75);
  near(parseRealLength('20′ 6″', 'ft'), 20.5);
  near(parseRealLength("1' 1/2\"", 'in'), 12.5);
});

test('marks convert into the picked unit', () => {
  near(parseRealLength("20'", 'm'), 6.096);
  near(parseRealLength('10"', 'cm'), 25.4);
});

test('plain numbers stay in the picked unit', () => {
  near(parseRealLength('12.5', 'm'), 12.5);
  near(parseRealLength('3/4', 'ft'), 0.75);
  near(parseRealLength('4 1/2', 'ft'), 4.5);
});

test('nonsense and zero read as nothing', () => {
  for (const bad of ['', 'abc', '0', "0'", '-3', "20' x", '1/0', '20-6']) {
    const unit = bad === '20-6' ? 'm' : 'ft';
    assert.equal(parseRealLength(bad, unit), null, bad);
  }
});

test('paper length words', () => {
  assert.equal(paperLengthWords(360), '5 in on paper');
  assert.equal(paperLengthWords(72, true), '25.4 mm on paper');
  assert.equal(paperLengthWords(0), '');
});

test('metric and yard lengths with a unit are read and turned into the picked unit (R4-A)', () => {
  assert.equal(parseRealLength('6 m', 'm'), 6);
  assert.equal(parseRealLength('6m', 'm'), 6);
  assert.ok(Math.abs(parseRealLength('3.5 cm', 'mm') - 35) < 1e-9);
  assert.ok(Math.abs(parseRealLength('450mm', 'm') - 0.45) < 1e-9);
  assert.ok(Math.abs(parseRealLength('2 yd', 'ft') - 6) < 1e-9);
  assert.ok(Math.abs(parseRealLength('1 m', 'ft') - 3.2808398950131235) < 1e-9);
  assert.equal(parseRealLength('0 m', 'm'), null);
});
