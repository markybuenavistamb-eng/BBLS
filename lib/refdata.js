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
const ORIGIN_PORTS = [
  { group: 'Thailand', ports: ['Laem Chabang, Thailand', 'Bangkok (Klong Toey), Thailand'] },
  { group: 'Cambodia', ports: ['Sihanoukville, Cambodia', 'Phnom Penh, Cambodia'] },
  { group: 'Vietnam', ports: ['Ho Chi Minh City (Cat Lai), Vietnam', 'Hai Phong, Vietnam', 'Da Nang, Vietnam'] },
  { group: 'Rest of Southeast Asia', ports: ['Singapore', 'Port Klang, Malaysia', 'Tanjung Pelepas, Malaysia', 'Jakarta, Indonesia'] },
  { group: 'East Asia', ports: ['Hong Kong', 'Shanghai, China', 'Ningbo, China', 'Shenzhen, China', 'Qingdao, China', 'Kaohsiung, Taiwan', 'Busan, South Korea', 'Tokyo, Japan', 'Yokohama, Japan', 'Osaka, Japan', 'Kobe, Japan'] },
  { group: 'Middle East', ports: ['Jebel Ali (Dubai), UAE', 'Abu Dhabi, UAE', 'Dammam, Saudi Arabia', 'Jeddah, Saudi Arabia', 'Doha, Qatar', 'Hamad, Qatar', 'Kuwait', 'Bahrain', 'Sohar, Oman'] },
  { group: 'USA — West Coast', ports: ['Los Angeles, USA', 'Long Beach, USA', 'Oakland, USA', 'Seattle, USA', 'Tacoma, USA', 'Portland, USA'] },
  { group: 'USA — East/Gulf', ports: ['New York/New Jersey, USA', 'Savannah, USA', 'Norfolk, USA', 'Houston, USA', 'Miami, USA'] },
  { group: 'Canada', ports: ['Vancouver, Canada', 'Prince Rupert, Canada', 'Toronto, Canada'] },
  { group: 'Europe', ports: ['Rotterdam, Netherlands', 'Antwerp, Belgium', 'Hamburg, Germany', 'Felixstowe, UK', 'Southampton, UK', 'Le Havre, France', 'Genoa, Italy', 'Barcelona, Spain'] },
  { group: 'Oceania', ports: ['Sydney, Australia', 'Melbourne, Australia', 'Brisbane, Australia', 'Auckland, New Zealand'] }
];

// Origin countries VFIC serves — the three primary Indochina lanes first.
const ORIGIN_COUNTRIES = ['Thailand', 'Cambodia', 'Vietnam', 'Singapore', 'Malaysia', 'Indonesia',
  'Hong Kong', 'China', 'Taiwan', 'South Korea', 'Japan', 'United Arab Emirates', 'Saudi Arabia',
  'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'United States', 'Canada', 'United Kingdom', 'Australia', 'New Zealand'];

// PH destination ports (where a consolidation arrives).
const DESTINATION_PORTS = ['Manila (MICP)', 'Manila (South Harbor)', 'Manila (North Harbor)', 'Batangas', 'Subic', 'Cebu', 'Davao', 'Cagayan de Oro', 'General Santos', 'Iloilo'];

module.exports = { SHIPPING_LINES, ORIGIN_PORTS, ORIGIN_COUNTRIES, DESTINATION_PORTS };
