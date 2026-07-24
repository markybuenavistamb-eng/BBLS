// VFIC standard balikbayan box sizes.
// Dimensions are the industry-standard outside measurements in INCHES (L x W x H).
// `standard_weight_kg` is the included weight allowance; above it an excess charge applies
// (rate is configurable in Admin → settings.excessWeightChargePerKg).
//
// NOTE ON CUSTOMS: BOC caps a box availing the Balikbayan Box privilege at 0.20 cbm
// ("about the size of an XL box"). A Jumbo box is ~0.227 cbm and therefore EXCEEDS that
// cap — flagged via `exceeds_boc_cbm` so the booking form can warn the sender.
const CUFT_TO_CBM = 0.0283168;
const BOC_MAX_CBM = 0.20;

function build(key, label, l, w, h, standardWeightKg) {
  const cuft = +((l * w * h) / 1728).toFixed(2);
  const cbm = +(cuft * CUFT_TO_CBM).toFixed(4);
  return {
    key, label,
    length_in: l, width_in: w, height_in: h,
    dimensions: `${l} x ${w} x ${h} in`,
    cubic_feet: cuft,
    cbm,
    standard_weight_kg: standardWeightKg,
    exceeds_boc_cbm: cbm > BOC_MAX_CBM
  };
}

const BOX_SIZES = [
  build('MINI',   'Mini',        12, 12, 12, 50),
  build('MEDIUM', 'Medium',      18, 18, 16, 50),
  build('LARGE',  'Large',       18, 18, 24, 60), // the standard balikbayan box
  build('XL',     'Extra Large', 24, 18, 24, 70),
  build('JUMBO',  'Jumbo',       24, 24, 24, 70)
];

const SIZE_KEYS = BOX_SIZES.map(s => s.key);
const bySize = (key) => BOX_SIZES.find(s => s.key === key) || null;

// Weight above the size's allowance (0 when within allowance / unknown size).
function excessWeightKg(sizeKey, weightKg) {
  const s = bySize(sizeKey);
  if (!s || !weightKg) return 0;
  return Math.max(0, +(weightKg - s.standard_weight_kg).toFixed(2));
}

module.exports = { BOX_SIZES, SIZE_KEYS, bySize, excessWeightKg, BOC_MAX_CBM, CUFT_TO_CBM };
