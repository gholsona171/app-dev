import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLoads, summarizeClasses, classCriteria, matchesCriteria } from '../js/grouping.js';

let n = 0;
const vehicle = (make, model, extra = {}) => ({ id: `v${++n}`, vin: `VIN${n}`, decoded: true, make, model, fuel: 'Gasoline', ...extra });
const many = (count, make, model, extra) => Array.from({ length: count }, () => vehicle(make, model, extra));
const combo = (id, items) => ({ id, name: id, loadTypeId: 'lt', items: items.map(([criteria, qty]) => ({ criteria, qty })) });

const F150 = { make: 'FORD', model: 'F-150' };
const EQUINOX = { make: 'CHEVROLET', model: 'Equinox' };

test('fills full loads and lists leftovers', () => {
  const vehicles = many(7, 'FORD', 'F-150');
  const plan = planLoads(vehicles, [combo('5F', [[F150, 5]])]);
  assert.equal(plan.loads.length, 1);
  assert.equal(plan.loads[0].vehicleIds.length, 5);
  assert.equal(plan.unassigned.length, 2);
  assert.equal(plan.unassigned[0].reason, 'Not enough for a full load');
});

test('finds a better plan than simply using the first combination', () => {
  // Using "5 F-150" first loads only 5. Two "3 F-150 + 1 Equinox" loads 8.
  const vehicles = [...many(6, 'FORD', 'F-150'), ...many(2, 'CHEVROLET', 'Equinox')];
  const plan = planLoads(vehicles, [combo('5F', [[F150, 5]]), combo('3F1E', [[F150, 3], [EQUINOX, 1]])]);
  assert.equal(plan.loads.length, 2);
  assert.ok(plan.loads.every((l) => l.comboId === '3F1E'));
  assert.equal(plan.unassigned.length, 0);
  assert.ok(plan.exhaustive);
});

test('uses priority order when plans are equally good', () => {
  const vehicles = many(5, 'FORD', 'F-150');
  const plan = planLoads(vehicles, [combo('first', [[F150, 5]]), combo('second', [[F150, 5]])]);
  assert.equal(plan.loads[0].comboId, 'first');
});

test('every vehicle is assigned at most once', () => {
  const vehicles = [...many(23, 'FORD', 'F-150'), ...many(9, 'CHEVROLET', 'Equinox')];
  const plan = planLoads(vehicles, [combo('5F', [[F150, 5]]), combo('3F1E', [[F150, 3], [EQUINOX, 1]]), combo('4E', [[EQUINOX, 4]])]);
  const ids = [...plan.loads.flatMap((l) => l.vehicleIds), ...plan.unassigned.map((u) => u.id)];
  assert.equal(ids.length, vehicles.length);
  assert.equal(new Set(ids).size, vehicles.length);
  assert.equal(plan.unassigned.length, 0);
});

test('detailed criteria only match the right vehicles', () => {
  const vehicles = [...many(2, 'CHEVROLET', 'Equinox', { fuel: 'Electric' }), ...many(2, 'CHEVROLET', 'Equinox')];
  const plan = planLoads(vehicles, [combo('2 EV', [[{ ...EQUINOX, fuel: 'Electric' }, 2]])]);
  assert.equal(plan.loads.length, 1);
  assert.ok(plan.loads[0].vehicleIds.every((id) => vehicles.find((v) => v.id === id).fuel === 'Electric'));
  assert.equal(plan.unassigned.filter((u) => u.reason === 'No combination includes this vehicle').length, 2);
});

test('undecoded vehicles are reported, not loaded', () => {
  const plan = planLoads([{ id: 'x', vin: 'X', decoded: false }], [combo('5F', [[F150, 5]])]);
  assert.deepEqual(plan.unassigned, [{ id: 'x', reason: 'Not decoded' }]);
  const invalid = planLoads([{ id: 'y', vin: 'Y', decoded: false, status: 'invalid' }], [combo('5F', [[F150, 5]])]);
  assert.deepEqual(invalid.unassigned, [{ id: 'y', reason: 'Invalid VIN' }]);
});

test('large inputs finish within the search budget', () => {
  const vehicles = [...many(300, 'FORD', 'F-150'), ...many(150, 'CHEVROLET', 'Equinox'), ...many(80, 'RAM', '1500')];
  const RAM = { make: 'RAM', model: '1500' };
  const combos = [
    combo('a', [[F150, 5]]), combo('b', [[F150, 3], [EQUINOX, 1]]), combo('c', [[EQUINOX, 4]]),
    combo('d', [[RAM, 2], [EQUINOX, 2]]), combo('e', [[RAM, 4]]), combo('f', [[F150, 2], [RAM, 2]]),
  ];
  const start = Date.now();
  const plan = planLoads(vehicles, combos);
  assert.ok(Date.now() - start < 3000);
  assert.ok(plan.loads.length > 0);
});

test('classCriteria and summarizeClasses follow toggles', () => {
  const v = vehicle('FORD', 'F-150', { trim: 'XLT' });
  assert.deepEqual(classCriteria(v, {}), F150);
  assert.deepEqual(classCriteria(v, { trim: true }), { ...F150, trim: 'XLT' });
  assert.ok(matchesCriteria(v, { make: 'ford', model: 'f-150' }));
  const classes = summarizeClasses([v, vehicle('FORD', 'F-150', { trim: 'Lariat' })], { trim: true });
  assert.equal(classes.length, 2);
  assert.equal(summarizeClasses([v, vehicle('FORD', 'F-150')], {}).length, 1);
});
