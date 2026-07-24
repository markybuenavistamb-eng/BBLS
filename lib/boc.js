// Field definitions for BOC Form BB-IS-001 ("Information Sheet for Consolidated
// Shipments of Balikbayan Boxes"), transcribed from the official form pages 1 & 2.
// Used by both the online booking form and the printed Information Sheet / Packing List.

// --- Page 1: Type of Availment ---
const AVAILMENT_TYPES = [
  { key: 'BB_1ST', group: 'Balikbayan Box privilege', label: '1st Time' },
  { key: 'BB_2ND', group: 'Balikbayan Box privilege', label: '2nd Time' },
  { key: 'BB_3RD', group: 'Balikbayan Box privilege', label: '3rd Time' },
  { key: 'DE_MINIMIS', group: null, label: 'De Minimis Value' },
  { key: 'NONE', group: null, label: 'None' }
];

// --- Page 1: Type of Sender ---
const SENDER_TYPES = [
  { key: 'QFWA_OFW', group: 'QFWA', label: 'OFW' },
  { key: 'QFWA_RESIDENT', group: 'QFWA', label: 'Resident Filipino' },
  { key: 'QFWA_NON_RESIDENT', group: 'QFWA', label: 'Non-Resident Filipino' },
  { key: 'NQFWA_INDIVIDUAL', group: 'NQFWA', label: 'Individual' },
  { key: 'NQFWA_SOLE_PROP', group: 'NQFWA', label: 'Sole Prop. (DTI)' },
  { key: 'NQFWA_PARTNERSHIP', group: 'NQFWA', label: 'Partnership' },
  { key: 'NQFWA_CORPORATION', group: 'NQFWA', label: 'Corporation' }
];
const SENDER_TYPE_GROUPS = {
  QFWA: 'Qualified Filipinos While Abroad (QFWA)',
  NQFWA: 'Non-Qualified Filipinos While Abroad (NQFWA)'
};
// Passport fields on the form are marked "(For QFWAs Only)"
const isQFWA = (senderType) => String(senderType || '').startsWith('QFWA_');

// --- Page 2: Relationship of recipient to sender (check one only) ---
const RELATIONSHIPS = [
  'Spouse', 'Child', 'Parent', 'Sibling', 'Sibling of Parent', '1st Cousin',
  'Niece/Nephew', 'Grandparent', 'Sibling of Grandparent', 'Grand Niece/Nephew',
  'Grandchild', 'Great Grandchild', 'Great Grandparent'
];

// --- Page 2: Itemized description of goods (fixed BOC checklist, 2 printed columns) ---
const GOODS_CATEGORIES = [
  'Bag/Wallet', 'Bakery, Breakfast, Cereal', 'Beverages', 'Books', 'Blanket/comforter',
  'Camera, used gadgets', 'Canned and Packed Foods', 'Candies', 'Children Accessories',
  'Chocolates', 'Cleaners', 'Clothes', 'Coffee/Milk Powder/Liquid', 'Component',
  'Cooking oil', 'Curtain', 'Detergent powder', 'Drink Can/Bottle', 'Fashion Accessories',
  'Furniture', 'Housewares, Decors, Home Furnishing', 'Luggage/Bags',
  'Laundry Materials', 'Miscellaneous Kitchen items', 'Noodles', 'Office/School Supplies',
  'Paper Goods', 'Pasta, noodles', 'Personal care', 'Personal Hygene', 'Plastic wares',
  'Produce(Fruits/Vegetables)', 'Refrigerated foods', 'Shoes', 'Sporting Goods / Hobbies',
  'Telephones / Fax', 'Tools(Mechanic,Automotive, etc.)', 'Towel/Face/Slippers/Sandal',
  'Toys', 'Umbrella', 'Wall Clock / Alarm Clock', 'Others'
];

// PH mobile number: 11 digits beginning 09 (e.g. 09171234567)
const PH_MOBILE_RE = /^09\d{9}$/;
function normalizePhMobile(v) { return String(v || '').replace(/\D/g, ''); }
function isValidPhMobile(v) { return PH_MOBILE_RE.test(normalizePhMobile(v)); }

module.exports = {
  AVAILMENT_TYPES, SENDER_TYPES, SENDER_TYPE_GROUPS, isQFWA,
  RELATIONSHIPS, GOODS_CATEGORIES,
  PH_MOBILE_RE, normalizePhMobile, isValidPhMobile
};
