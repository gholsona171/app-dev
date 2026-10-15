// Vehicle classification and load planning.
//
// A "combination" is one allowed load, e.g. 5 x F-150 or 3 x F-150 + 1 x Equinox.
// Each combination item has `criteria` (make + model, plus any optional fields
// that were switched on when the item was created) and a quantity.

export const OPTIONAL_FIELDS = [
  { key: 'year', label: 'Model year' },
  { key: 'trim', label: 'Trim' },
  { key: 'body', label: 'Body / cab style' },
  { key: 'fuel', label: 'Fuel type (EV / gas)' },
  { key: 'drive', label: 'Drive type' },
];

const PROFILE_FIELDS = ['make', 'model', ...OPTIONAL_FIELDS.map((f) => f.key)];

const norm = (value) => String(value ?? '').trim().toUpperCase();

// Criteria describing a vehicle at the detail level chosen by the toggles.
export function classCriteria(vehicle, toggles = {}) {
  const criteria = { make: vehicle.make, model: vehicle.model };
  for (const { key } of OPTIONAL_FIELDS) {
    if (toggles[key]) criteria[key] = vehicle[key] || '';
  }
  return criteria;
}

export function criteriaKey(criteria) {
  return PROFILE_FIELDS.filter((k) => k in criteria).map((k) => `${k}=${norm(criteria[k])}`).join('|');
}

export function criteriaLabel(criteria) {
  const parts = [criteria.year, criteria.make, criteria.model, criteria.trim, criteria.body, criteria.fuel, criteria.drive];
  return parts.filter((p) => p !== undefined && p !== '').join(' · ') || 'Unknown';
}

export function matchesCriteria(vehicle, criteria) {
  return Object.keys(criteria).every((k) => norm(vehicle[k]) === norm(criteria[k]));
}

// Groups vehicles into classes at the chosen detail level.
export function summarizeClasses(vehicles, toggles) {
  const classes = new Map();
  for (const v of vehicles) {
    if (!v.decoded) continue;
    const criteria = classCriteria(v, toggles);
    const key = criteriaKey(criteria);
    if (!classes.has(key)) classes.set(key, { key, criteria, label: criteriaLabel(criteria), count: 0 });
    classes.get(key).count++;
  }
  return [...classes.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function comboSize(combo) {
  return combo.items.reduce((sum, item) => sum + item.qty, 0);
}

// Builds load groups from vehicles and allowed combinations.
//
// Searches for the plan that loads the most vehicles, then uses the fewest
// loads. Combinations earlier in the list are tried first, so on a tie the
// user's priority order wins. Large inputs stop after `budget` search steps
// and return the best plan found so far (`exhaustive: false`).
export function planLoads(vehicles, combos, { budget = 50000 } = {}) {
  const usableCombos = combos.filter((c) => c.items.length > 0 && c.items.every((i) => i.qty > 0));

  // Collapse vehicles into profiles (identical on every field) to keep the search small.
  const profiles = [];
  const profileIndex = new Map();
  const notDecoded = [];
  for (const v of vehicles) {
    if (!v.decoded) {
      notDecoded.push({ id: v.id, reason: v.status === 'invalid' ? 'Invalid VIN' : 'Not decoded' });
      continue;
    }
    const key = criteriaKey(Object.fromEntries(PROFILE_FIELDS.map((k) => [k, v[k] || ''])));
    if (!profileIndex.has(key)) {
      profileIndex.set(key, profiles.length);
      profiles.push({ sample: v, ids: [] });
    }
    profiles[profileIndex.get(key)].ids.push(v.id);
  }

  // For each combination item, which profiles can fill it. Most specific items fill first.
  const plans = usableCombos.map((combo) => ({
    combo,
    items: [...combo.items]
      .sort((a, b) => Object.keys(b.criteria).length - Object.keys(a.criteria).length)
      .map((item) => ({
        qty: item.qty,
        profiles: profiles.map((p, i) => (matchesCriteria(p.sample, item.criteria) ? i : -1)).filter((i) => i >= 0),
      })),
  }));

  const usable = new Set(plans.flatMap((p) => p.items.flatMap((i) => i.profiles)));

  // Tries to fill one load of `plan` from `counts`. Returns the taken amounts or null.
  function fill(plan, counts) {
    const next = counts.slice();
    const taken = [];
    for (const item of plan.items) {
      let need = item.qty;
      const candidates = item.profiles.filter((i) => next[i] > 0).sort((a, b) => next[b] - next[a]);
      for (const i of candidates) {
        if (need === 0) break;
        const n = Math.min(need, next[i]);
        next[i] -= n;
        need -= n;
        taken.push([i, n]);
      }
      if (need > 0) return null;
    }
    return { next, taken };
  }

  const startCounts = profiles.map((p) => p.ids.length);
  let best = { loaded: 0, loads: [] };
  let steps = 0;
  let exhaustive = true;

  function search(start, counts, loaded, loads) {
    if (loaded > best.loaded || (loaded === best.loaded && loads.length < best.loads.length)) {
      best = { loaded, loads: loads.slice() };
    }
    if (++steps > budget) {
      exhaustive = false;
      return;
    }
    let remainingUsable = 0;
    for (const i of usable) remainingUsable += counts[i];
    if (loaded + remainingUsable < best.loaded) return;
    if (loaded + remainingUsable === best.loaded && loads.length >= best.loads.length) return;

    for (let c = start; c < plans.length; c++) {
      const result = fill(plans[c], counts);
      if (!result) continue;
      loads.push({ plan: c, taken: result.taken });
      search(c, result.next, loaded + comboSize(plans[c].combo), loads);
      loads.pop();
      if (!exhaustive) return;
    }
  }

  search(0, startCounts, 0, []);

  // Turn the chosen counts back into actual vehicles.
  const pools = profiles.map((p) => p.ids.slice());
  const loads = best.loads.map(({ plan, taken }) => {
    const combo = plans[plan].combo;
    return {
      comboId: combo.id,
      comboName: combo.name,
      loadTypeId: combo.loadTypeId,
      vehicleIds: taken.flatMap(([i, n]) => pools[i].splice(0, n)),
    };
  });

  const unassigned = [
    ...notDecoded,
    ...pools.flatMap((ids, i) =>
      ids.map((id) => ({ id, reason: usable.has(i) ? 'Not enough for a full load' : 'No combination includes this vehicle' })),
    ),
  ];

  return { loads, unassigned, exhaustive };
}
