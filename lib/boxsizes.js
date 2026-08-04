// VFIC standard balikbayan box sizes.
// Dimensions are the outside measurements in CENTIMETRES (L x W x H).
// `standard_weight_kg` is the included weight allowance; above it an excess charge applies
// (rate is configurable in Admin → settings.excessWeightChargePerKg).
//
// NOTE ON CUSTOMS: BOC caps a box availing the Balikbayan Box privilege at 0.20 cbm.
// Large (0.227 cbm) and Giga (0.318 cbm) EXCEED that cap — flagged via `exceeds_boc_cbm`
// so the booking form can warn the sender.
const CBM_TO_CUFT = 35.3147;
const BOC_MAX_CBM = 0.20;

function build(key, label, l, w, h, standardWeightKg) {
  const cbm = +((l * w * h) / 1e6).toFixed(4);          // cm³ → cbm
  const cuft = +(cbm * CBM_TO_CUFT).toFixed(2);
  return {
    key, label,
    length_cm: l, width_cm: w, height_cm: h,
    dimensions: `${l} x ${w} x ${h} cm`,
    cubic_feet: cuft,
    cbm,
    standard_weight_kg: standardWeightKg,
    exceeds_boc_cbm: cbm > BOC_MAX_CBM
  };
}

const BOX_SIZES = [
  build('SMALL',  'Small',    55, 55, 40,  50),
  build('MEDIUM', 'Medium',   55, 55, 60,  60),
  build('LARGE',  'Large',    55, 55, 75,  70),
  build('GIGA',   'Giga Box', 55, 55, 105, 80)
];

const SIZE_KEYS = BOX_SIZES.map(s => s.key);

// Older records may carry the previous imperial size keys — map them onto the current
// catalogue so historical boxes still resolve to a size.
const LEGACY_SIZE_ALIASES = { MINI: 'SMALL', XL: 'LARGE', JUMBO: 'GIGA', CUSTOM: 'LARGE' };
const canonicalSize = (key) => {
  const k = String(key || '').toUpperCase();
  return SIZE_KEYS.includes(k) ? k : (LEGACY_SIZE_ALIASES[k] || null);
};
const bySize = (key) => BOX_SIZES.find(s => s.key === canonicalSize(key)) || null;

// Weight above the size's allowance (0 when within allowance / unknown size).
function excessWeightKg(sizeKey, weightKg) {
  const s = bySize(sizeKey);
  if (!s || !weightKg) return 0;
  return Math.max(0, +(weightKg - s.standard_weight_kg).toFixed(2));
}

module.exports = {
  BOX_SIZES, SIZE_KEYS, bySize, canonicalSize, LEGACY_SIZE_ALIASES,
  excessWeightKg, BOC_MAX_CBM, CBM_TO_CUFT
};
