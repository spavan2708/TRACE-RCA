import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, PRESETS, DEFAULT_SAMPLE, CLASSES, validateValue, validPrediction, validRecord } from '../frontend/telemetry.js';

test('all demo snapshots preserve feature values and fit client validation', () => {
  for (const sample of Object.values(PRESETS)) {
    assert.equal(Object.keys(sample).length, 10);
    for (const feature of FEATURES) assert.equal(validateValue(feature, sample[feature.key]), '');
  }
  assert.equal(DEFAULT_SAMPLE.error_rate, 90);
});

test('validation rejects blanks, nonfinite values, invalid percentages and fractional restarts', () => {
  const cpu = FEATURES.find(feature => feature.key === 'cpu_usage');
  for (const value of ['', null, undefined, NaN, Infinity, -1, 101, 'oops']) assert.ok(validateValue(cpu, value));
  assert.equal(validateValue(cpu, 0), '');
  assert.equal(validateValue(cpu, 100), '');
  assert.ok(validateValue(FEATURES.find(feature => feature.key === 'service_restarts'), 1.5));
});

test('continuous counts and out-of-training-range values are not silently clamped', () => {
  assert.equal(validateValue(FEATURES.find(feature => feature.key === 'db_connections'), 22.75), '');
  assert.equal(validateValue(FEATURES.find(feature => feature.key === 'request_rate'), 2500), '');
});

const prediction = { root_cause: 'Service Crash', confidence: 0.8, probabilities: Object.fromEntries(CLASSES.map(name => [name, name === 'Service Crash' ? 0.8 : 0.05])) };
test('prediction guard rejects inconsistent or malformed backend results', () => {
  assert.ok(validPrediction(prediction));
  assert.equal(validPrediction({ ...prediction, confidence: NaN }), false);
  assert.equal(validPrediction({ ...prediction, confidence: 0.9 }), false);
  assert.equal(validPrediction({ ...prediction, root_cause: '<script>' }), false);
  assert.equal(validPrediction({ ...prediction, probabilities: {} }), false);
  assert.equal(validPrediction({ ...prediction, probabilities: { ...prediction.probabilities, 'Memory Leak': 0.8 } }), false);
});

test('stored history requires a valid complete snapshot', () => {
  const record = { id: 'one', timestamp: new Date().toISOString(), duration_ms: 34, telemetry: DEFAULT_SAMPLE, result: prediction };
  assert.ok(validRecord(record));
  assert.equal(Boolean(validRecord({ ...record, telemetry: {} })), false);
  assert.equal(Boolean(validRecord({ ...record, timestamp: 'yesterday' })), false);
  assert.equal(Boolean(validRecord({ ...record, result: null })), false);
});
