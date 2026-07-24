// Box status state machine per spec §7. All transition validation lives here.

const BOX_STATUSES = [
  'CREATED', 'RECEIVED_ORIGIN', 'LOADED_CONTAINER', 'IN_TRANSIT', 'ARRIVED_PORT',
  'RECEIVED_WAREHOUSE', 'SORTED', 'ASSIGNED', 'LOADED_TRUCK', 'OUT_FOR_DELIVERY',
  'DELIVERED', 'RETURNED', 'CANCELLED'
];

// Friendly labels used on the public tracking page and staff UI.
const FRIENDLY = {
  CREATED: 'Registered',
  RECEIVED_ORIGIN: 'Received at origin',
  LOADED_CONTAINER: 'Loaded in container',
  IN_TRANSIT: 'On the way to the Philippines',
  ARRIVED_PORT: 'Arrived in the Philippines',
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
  CREATED: ['RECEIVED_ORIGIN'],
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
  if (to === 'CANCELLED') return actorRole === 'ADMIN' && PRE_DELIVERY.includes(from);
  return (TRANSITIONS[from] || []).includes(to);
}

const CONTAINER_STATUSES = ['BOOKING', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'AT_CUSTOMS', 'RELEASED', 'STRIPPED'];
const CONTAINER_SIZES = ['C20', 'C40', 'C40HQ'];
const CONTAINER_SIZE_LABELS = { C20: "20 ft", C40: "40 ft", C40HQ: "40 ft HQ" };
const TRIP_STATUSES = ['PLANNED', 'LOADING', 'DISPATCHED', 'COMPLETED'];
const REGIONS = ['NCR', 'NORTH_LUZON', 'SOUTH_LUZON', 'CALABARZON', 'MIMAROPA', 'VISAYAS', 'MINDANAO'];
const SERVICE_TYPES = ['DOOR_TO_DOOR', 'PORT_TO_PORT', 'DOOR_TO_PORT', 'DOOR_TO_AIRPORT'];
const SIZE_CATEGORIES = require('./boxsizes').SIZE_KEYS; // MINI | MEDIUM | LARGE | XL | JUMBO
const FAILURE_REASONS = ['UNREACHABLE', 'ADDRESS_NOT_FOUND', 'RECEIVER_ABSENT', 'REFUSED', 'OTHER'];

module.exports = {
  BOX_STATUSES, FRIENDLY, TRANSITIONS, PRE_DELIVERY, canTransition,
  CONTAINER_STATUSES, CONTAINER_SIZES, CONTAINER_SIZE_LABELS,
  TRIP_STATUSES, REGIONS, SERVICE_TYPES, SIZE_CATEGORIES, FAILURE_REASONS
};
