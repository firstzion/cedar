// Settings for the demo site. Change here, not in the generator code.
export const SITE = {
  dis: 'Demo Office', // fictional site
  tzHaystack: 'Los_Angeles', // Haystack tz name stored on records
  tzIana: 'America/Los_Angeles', // used for local-time maths
  areaFt2: 50000,
  geoAddr: '100 Demo Way',
  geoCity: 'Los Angeles',
  geoState: 'CA',
  geoPostalCode: '90001',
  geoCountry: 'US',
  lat: 34.05,
  lng: -118.24,
  yearBuilt: 2008,
}

export const DEFAULT_SEED = 42
export const DAYS = 90
export const INTERVAL_MIN = 15
export const SAMPLES = DAYS * 24 * (60 / INTERVAL_MIN) // 8640

/** Haxall keeps only 1000 history items per point unless this tag says otherwise. */
export const HIS_MAX_ITEMS = 20000

/** Marker tag on every record we create; reset removes exactly these. */
export const DEMO_TAG = 'demoData'
