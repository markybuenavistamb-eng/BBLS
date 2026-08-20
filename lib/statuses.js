// Box status state machine per spec §7. All transition validation lives here.

const BOX_STATUSES = [
  'CREATED', 'RECEIVED_BRANCH', 'RECEIVED_ORIGIN', 'LOADED_CONTAINER', 'IN_TRANSIT', 'ARRIVED_PORT',
  'RECEIVED_WAREHOUSE', 'SORTED', 'ASSIGNED', 'LOADED_TRUCK', 'OUT_FOR_DELIVERY',
  'DELIVERED', 'RETURNED', 'CANCELLED'
];

// Statuses a box holds while it is still at the origin branch abroad. Until a box sails it
// is branch business: Manila's warehouse and delivery staff have nothing to do with a box
// sitting in Bangkok, and their views start from the moment it leaves.
const ORIGIN_SIDE_STATUSES = ['CREATED', 'RECEIVED_BRANCH', 'RECEIVED_ORIGIN', 'LOADED_CONTAINER'];
const hasShipped = (status) => !ORIGIN_SIDE_STATUSES.includes(status);
// A container is still being stuffed at origin until it departs.
const CONTAINER_ORIGIN_STATUSES = ['BOOKING', 'LOADING'];
const containerHasShipped = (status) => !CONTAINER_ORIGIN_STATUSES.includes(status);

// Friendly labels used on the public tracking page and staff UI.
const FRIENDLY = {
  CREATED: 'Booking Confirmed',
  RECEIVED_BRANCH: 'Received at origin branch office',
  RECEIVED_ORIGIN: 'Received at origin warehouse',
  LOADED_CONTAINER: 'Loaded in container',
  IN_TRANSIT: 'On the way to Destination',
  ARRIVED_PORT: 'Arrived at Destination',
  RECEIVED_WAREHOUSE: 'Received at warehouse',
  SORTED: 'Sorted for delivery region',
  ASSIGNED: 'Scheduled for delivery',
  LOADED_TRUCK: 'Loaded on delivery truck',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  RETURNED: 'Delivery attempted — returned to warehouse',
  CANCELLED: 'Cancelled'
};

const TRANSITIONS = {
  CREATED: ['RECEIVED_BRANCH', 'RECEIVED_ORIGIN'],   // second = dropped straight at the warehouse
  RECEIVED_BRANCH: ['RECEIVED_ORIGIN'],
  RECEIVED_ORIGIN: ['LOADED_CONTAINER'],
  LOADED_CONTAINER: ['IN_TRANSIT', 'RECEIVED_ORIGIN'], // second = unloaded from container
  IN_TRANSIT: ['ARRIVED_PORT'],
  ARRIVED_PORT: ['RECEIVED_WAREHOUSE'],
  RECEIVED_WAREHOUSE: ['SORTED'],
  SORTED: ['ASSIGNED'],
  ASSIGNED: ['LOADED_TRUCK', 'SORTED'], // second = removed from trip
  LOADED_TRUCK: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RETURNED'],
  RETURNED: ['ASSIGNED'],
  DELIVERED: [],
  CANCELLED: []
};

const PRE_DELIVERY = BOX_STATUSES.filter(s => !['DELIVERED', 'CANCELLED'].includes(s));

function canTransition(from, to, actorRole) {
  if (to === 'CANCELLED') return require('./roles').isAdmin(actorRole) && PRE_DELIVERY.includes(from);
  return (TRANSITIONS[from] || []).includes(to);
}

const CONTAINER_STATUSES = ['BOOKING', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'AT_CUSTOMS', 'RELEASED', 'STRIPPED'];
const CONTAINER_SIZES = ['C20', 'C40', 'C40HQ'];
const CONTAINER_SIZE_LABELS = { C20: "20 ft", C40: "40 ft", C40HQ: "40 ft HQ" };
// Usable internal capacity per container type, to VFIC's operating figures.
// `cbm` is the full internal volume; real stuffing never reaches 100% because boxes cannot
// tessellate perfectly — the load planner applies a utilisation factor on top.
// `payload_kg` is the maximum cargo weight the box may carry.
const CONTAINER_CAPACITY = {
  C20:   { cbm: 33.2, cbm_min: 33.0, payload_kg: 24000 },
  C40:   { cbm: 67.7, payload_kg: 28000 },
  C40HQ: { cbm: 76.3, payload_kg: 30480 }
};
const DEFAULT_STUFFING_UTILISATION = 0.85;
const TRIP_STATUSES = ['PLANNED', 'LOADING', 'DISPATCHED', 'COMPLETED'];
const REGIONS = require('./regions').CODES; // the 17 official PSGC regions
const SERVICE_TYPES = ['DOOR_TO_DOOR', 'PORT_TO_PORT', 'DOOR_TO_PORT', 'DOOR_TO_AIRPORT'];
// Service level = the freight product chosen at booking (speed / mode).
const SERVICE_LEVELS = ['OCEAN_ECONOMY', 'OCEAN_PRIORITY', 'EXPRESS_AIR'];
const SERVICE_LEVEL_LABELS = { OCEAN_ECONOMY: 'Ocean Economy', OCEAN_PRIORITY: 'Ocean Priority', EXPRESS_AIR: 'Express Air' };
const COLLECTION_METHODS = ['PICKUP', 'DROPOFF'];
const SIZE_CATEGORIES = require('./boxsizes').SIZE_KEYS; // MINI | MEDIUM | LARGE | XL | JUMBO
const FAILURE_REASONS = ['UNREACHABLE', 'ADDRESS_NOT_FOUND', 'RECEIVER_ABSENT', 'REFUSED', 'OTHER'];

module.exports = {
  BOX_STATUSES, FRIENDLY, TRANSITIONS, PRE_DELIVERY, canTransition,
  ORIGIN_SIDE_STATUSES, hasShipped, CONTAINER_ORIGIN_STATUSES, containerHasShipped,
  CONTAINER_STATUSES, CONTAINER_SIZES, CONTAINER_SIZE_LABELS,
  CONTAINER_CAPACITY, DEFAULT_STUFFING_UTILISATION,
  TRIP_STATUSES, REGIONS, SERVICE_TYPES, SERVICE_LEVELS, SERVICE_LEVEL_LABELS,
  COLLECTION_METHODS, SIZE_CATEGORIES, FAILURE_REASONS
};
