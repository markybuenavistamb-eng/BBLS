// Shared reference lists for the Container module.

// Shipping lines — AISL (Association of International Shipping Lines, Philippines) member list.
// Source: https://aisl.ph/member-list/
const SHIPPING_LINES = [
  'APL Company Pte., Ltd.',
  'Asean Seas Line Co., Limited',
  'Australian National Line',
  'CMA-CGM (The French Line)',
  'Cosco Container Lines Co., Ltd.',
  'Evergreen Line',
  'Far Eastern Shipping Company',
  'Gold Star Line, Ltd.',
  'Hapag-Lloyd',
  'Heung-A Shipping Co., Ltd.',
  'Hyundai Merchant Marine Co., Ltd.',
  'Kanway Lines Company Ltd.',
  'Kawasaki Kisen Kaisha, Ltd. (“K” Line)',
  'Korea Marine Transport Co., Ltd.',
  'Kyowa Line Shipping Co., Ltd.',
  'Macrocean International Shipping Ltd.',
  'Maersk Line',
  'Mariana Express Lines, Ltd.',
  'MSC Mediterranean Shipping Company S.A., Geneva',
  'Namsung Shipping Co., Ltd.',
  'New Golden Sea Shipping Pte., Ltd.',
  'Ocean Network Express (ONE)',
  'Orient Overseas Container Lines (OOCL)',
  'Pacific International Lines Pte. Ltd. (PIL)',
  'Regional Container Lines Pte. Ltd. (RCL)',
  'Sinokor Merchant Marine Co., Ltd.',
  'Sinotrans Container Lines Co., Ltd.',
  'SITC Container Lines Co., Ltd.',
  'Swire Shipping Pte. Ltd.',
  'TS Lines Limited',
  'Unifeeder Group',
  'Wan Hai Lines, Ltd.',
  'Westwind Shipping Corporation',
  'Yangming Marine Transport Corp.',
  'Zim Integrated Shipping Services, Inc.'
];

// Common international origin ports for balikbayan / cargo consolidations, grouped by region.
// Used as a dropdown when booking a container (free text still allowed via "Other").
// VFIC's primary lanes are the Indochina origins — Thailand, Cambodia and Vietnam — so
// they are listed first.
// VFIC ships from two origins only: Thailand and Cambodia, each run by its own branch.
const ORIGIN_PORTS = [
  { group: 'Thailand', ports: ['Laem Chabang, Thailand', 'Bangkok (Klong Toey), Thailand'] },
  { group: 'Cambodia', ports: ['Sihanoukville, Cambodia', 'Phnom Penh, Cambodia'] }
];

// Origin countries VFIC serves.
const ORIGIN_COUNTRIES = ['Thailand', 'Cambodia'];

// Dialling code and number shapes per origin lane, so a sender filling in the booking form
// is told what a valid number looks like in their own country instead of guessing. Mobile
// and landline differ in both length and prefix, so each is spelled out separately.
const PHONE_FORMATS = {
  Thailand: {
    dial_code: '+66',
    // Thai numbers are written with a leading 0 locally; that 0 is dropped after +66.
    mobile: { hint: 'Mobile: 9 digits starting 6, 8 or 9 — e.g. 812345678', example: '812345678', pattern: '^[689]\\d{8}$' },
    landline: { hint: 'Landline: 8 digits including the area code — e.g. 21234567 (Bangkok)', example: '21234567', pattern: '^[2-7]\\d{7}$' },
    note: 'Leave off the leading 0 — it is not used after +66.'
  },
  Cambodia: {
    dial_code: '+855',
    mobile: { hint: 'Mobile: 8 or 9 digits — e.g. 12345678', example: '12345678', pattern: '^\\d{8,9}$' },
    landline: { hint: 'Landline: 8 digits including the area code — e.g. 23123456 (Phnom Penh)', example: '23123456', pattern: '^\\d{8}$' },
    note: 'Leave off the leading 0 — it is not used after +855.'
  },
  Philippines: {
    dial_code: '+63',
    mobile: { hint: 'Mobile: 11 digits starting 09 — e.g. 09171234567', example: '09171234567', pattern: '^09\\d{9}$' },
    landline: { hint: 'Landline: area code + number — e.g. 0281234567', example: '0281234567', pattern: '^0\\d{9}$' },
    note: ''
  }
};
const phoneFormatFor = (country) => PHONE_FORMATS[country] || null;

// Ports available to a given origin country (a branch only books from its own country).
const originPortsFor = (country) => {
  const g = ORIGIN_PORTS.find(x => x.group === country);
  return g ? g.ports.slice() : ORIGIN_PORTS.flatMap(x => x.ports);
};

// PH destination ports (where a consolidation arrives).
const DESTINATION_PORTS = [
  'Manila International Container Terminal (North)',
  'Port of Manila (South)'
];

module.exports = { SHIPPING_LINES, ORIGIN_PORTS, ORIGIN_COUNTRIES, originPortsFor, DESTINATION_PORTS, PHONE_FORMATS, phoneFormatFor };
