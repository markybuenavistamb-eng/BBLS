// Accounting rate cards.
//
// Pricing has three parts:
//   1. empty_box_price   — what a customer pays to buy an empty balikbayan box, per size.
//   2. ocean             — per-BOX rate for OCEAN_ECONOMY / OCEAN_PRIORITY, per size, per zone.
//   3. air               — per-KILO rate for EXPRESS_AIR, per zone.
//
// Everything is editable in Accounting → Rate Cards; the values below are the starting
// defaults (all zero) so VFIC fills in its own commercial rates.

const BOXSIZE = require('./boxsizes');
const REGION = require('./regions');
const SM = require('./statuses');

// Container sizes an all-in inter-branch charge is quoted against.
const CONTAINER_SIZES = SM.CONTAINER_SIZES;
const CONTAINER_SIZE_LABELS = SM.CONTAINER_SIZE_LABELS;

// Billing destination zones (coarser than the 17 PSGC delivery regions).
const ZONES = [
  { key: 'METRO_MANILA',      label: 'Metro Manila' },
  { key: 'LUZON',             label: 'Luzon' },
  { key: 'LUZON_INTERISLAND', label: 'Luzon Inter-island' },
  { key: 'VISAYAS',           label: 'Visayas' },
  { key: 'MINDANAO',          label: 'Mindanao' }
];
const ZONE_KEYS = ZONES.map(z => z.key);
const ZONE_LABELS = Object.fromEntries(ZONES.map(z => [z.key, z.label]));

// Which billing zone a PSGC delivery region falls into.
const REGION_ZONE = {
  NCR: 'METRO_MANILA',
  CAR: 'LUZON', R1: 'LUZON', R2: 'LUZON', R3: 'LUZON', R4A: 'LUZON', R5: 'LUZON',
  MIMAROPA: 'LUZON_INTERISLAND',
  R6: 'VISAYAS', R7: 'VISAYAS', R8: 'VISAYAS',
  R9: 'MINDANAO', R10: 'MINDANAO', R11: 'MINDANAO', R12: 'MINDANAO', R13: 'MINDANAO', BARMM: 'MINDANAO'
};
const zoneForRegion = (region) => REGION_ZONE[region] || null;

const OCEAN_LEVELS = ['OCEAN_ECONOMY', 'OCEAN_PRIORITY'];
const AIR_LEVEL = 'EXPRESS_AIR';

// A blank rate card: zeroes for every size/zone combination.
function defaultRateCard() {
  const perSize = () => Object.fromEntries(BOXSIZE.SIZE_KEYS.map(k => [k, 0]));
  const perZoneSize = () => Object.fromEntries(ZONE_KEYS.map(z => [z, perSize()]));
  return {
    currency: 'PHP',
    empty_box_price: perSize(),
    ocean: Object.fromEntries(OCEAN_LEVELS.map(l => [l, perZoneSize()])),
    air: { [AIR_LEVEL]: Object.fromEntries(ZONE_KEYS.map(z => [z, 0])) },
    // ALL-IN charge head office bills an origin branch per CONTAINER, by container size,
    // covering the whole destination-side service (customs, warehouse, stripping, sorting and
    // last-mile delivery of every box inside). Basis for inter-branch settlements.
    interbranch_container: Object.fromEntries(CONTAINER_SIZES.map(k => [k, 0])),
    updated_at: null,
    updated_by: null
  };
}

// Fill in any size/zone added after a card was saved, so lookups never hit undefined.
function normalizeRateCard(card) {
  const base = defaultRateCard();
  if (!card || typeof card !== 'object') return base;
  const out = { ...base, ...card, currency: card.currency || base.currency };
  out.empty_box_price = { ...base.empty_box_price, ...(card.empty_box_price || {}) };
  out.ocean = {};
  for (const lvl of OCEAN_LEVELS) {
    out.ocean[lvl] = {};
    for (const z of ZONE_KEYS) {
      out.ocean[lvl][z] = { ...base.ocean[lvl][z], ...(((card.ocean || {})[lvl] || {})[z] || {}) };
    }
  }
  out.air = { [AIR_LEVEL]: { ...base.air[AIR_LEVEL], ...((card.air || {})[AIR_LEVEL] || {}) } };
  out.interbranch_container = { ...base.interbranch_container, ...(card.interbranch_container || {}) };
  return out;
}

// The all-in charge for handling one container of the given size at destination.
function containerFee(card, size) {
  const c = normalizeRateCard(card);
  const k = CONTAINER_SIZES.includes(size) ? size : 'C40';
  return { amount: num(c.interbranch_container[k]), currency: c.currency, label: CONTAINER_SIZE_LABELS[k] || k };
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

// Price one box. Ocean levels charge per box by size; Express Air charges per kilo
// (chargeable weight = max of actual weight and the size's standard allowance is NOT used —
// air is billed on actual weight, which is what the sender declares).
function priceBox({ card, service_level, zone, size_category, weight_kg }) {
  const c = normalizeRateCard(card);
  const size = BOXSIZE.canonicalSize(size_category) || 'LARGE';
  if (!zone || !ZONE_KEYS.includes(zone)) return { amount: 0, basis: 'unzoned', currency: c.currency };
  if (service_level === AIR_LEVEL) {
    const perKg = num(c.air[AIR_LEVEL][zone]);
    const kg = num(weight_kg);
    return { amount: +(perKg * kg).toFixed(2), basis: `${perKg}/kg × ${kg} kg`, currency: c.currency };
  }
  const lvl = OCEAN_LEVELS.includes(service_level) ? service_level : 'OCEAN_ECONOMY';
  const amount = num(c.ocean[lvl][zone][size]);
  return { amount: +amount.toFixed(2), basis: `${lvl.replace('_', ' ').toLowerCase()} · ${size}`, currency: c.currency };
}

function emptyBoxPrice(card, size_category) {
  const c = normalizeRateCard(card);
  const size = BOXSIZE.canonicalSize(size_category) || 'LARGE';
  return { amount: num(c.empty_box_price[size]), currency: c.currency };
}

module.exports = {
  ZONES, ZONE_KEYS, ZONE_LABELS, REGION_ZONE, zoneForRegion,
  OCEAN_LEVELS, AIR_LEVEL,
  CONTAINER_SIZES, CONTAINER_SIZE_LABELS,
  defaultRateCard, normalizeRateCard, priceBox, emptyBoxPrice, containerFee
};
