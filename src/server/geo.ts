export type CityPoint = { lat: number; lng: number; state: string; country: string };

export const CITY_COORDS: Record<string, CityPoint> = {
  mumbai: { lat: 19.076, lng: 72.8777, state: "Maharashtra", country: "India" },
  pune: { lat: 18.5204, lng: 73.8567, state: "Maharashtra", country: "India" },
  nashik: { lat: 19.9975, lng: 73.7898, state: "Maharashtra", country: "India" },
  nagpur: { lat: 21.1458, lng: 79.0882, state: "Maharashtra", country: "India" },
  ahmedabad: { lat: 23.0225, lng: 72.5714, state: "Gujarat", country: "India" },
  surat: { lat: 21.1702, lng: 72.8311, state: "Gujarat", country: "India" },
  vadodara: { lat: 22.3072, lng: 73.1812, state: "Gujarat", country: "India" },
  delhi: { lat: 28.6139, lng: 77.209, state: "Delhi", country: "India" },
  "new delhi": { lat: 28.6139, lng: 77.209, state: "Delhi", country: "India" },
  gurugram: { lat: 28.4595, lng: 77.0266, state: "Haryana", country: "India" },
  gurgaon: { lat: 28.4595, lng: 77.0266, state: "Haryana", country: "India" },
  jaipur: { lat: 26.9124, lng: 75.7873, state: "Rajasthan", country: "India" },
  bengaluru: { lat: 12.9716, lng: 77.5946, state: "Karnataka", country: "India" },
  bangalore: { lat: 12.9716, lng: 77.5946, state: "Karnataka", country: "India" },
  chennai: { lat: 13.0827, lng: 80.2707, state: "Tamil Nadu", country: "India" },
  hyderabad: { lat: 17.385, lng: 78.4867, state: "Telangana", country: "India" },
  kolkata: { lat: 22.5726, lng: 88.3639, state: "West Bengal", country: "India" },
  indore: { lat: 22.7196, lng: 75.8577, state: "Madhya Pradesh", country: "India" },
  ludhiana: { lat: 30.901, lng: 75.8573, state: "Punjab", country: "India" },
  coimbatore: { lat: 11.0168, lng: 76.9558, state: "Tamil Nadu", country: "India" },
};

export function resolveCity(input: string | null | undefined) {
  if (!input) return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  if (CITY_COORDS[key]) return { name: titleCity(key), ...CITY_COORDS[key] };
  const found = Object.entries(CITY_COORDS).find(([name]) => key.includes(name));
  if (!found) return null;
  return { name: titleCity(found[0]), ...found[1] };
}

function titleCity(key: string) {
  return key.replace(/\b\w/g, (m) => m.toUpperCase());
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(s)) * 10) / 10;
}
