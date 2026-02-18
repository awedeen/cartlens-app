// Geolocation service using MaxMind GeoLite2
// For now, returns mock data since we need the MMDB file

export interface GeoLocation {
  city: string | null;
  country: string | null;
  countryCode: string | null;
}

export async function lookupIP(ip: string): Promise<GeoLocation> {
  // TODO: Integrate MaxMind GeoLite2 when MMDB file is available
  // For development, return mock data based on IP patterns
  
  // Mock some common IPs for testing
  const mockData: Record<string, GeoLocation> = {
    "127.0.0.1": { city: "Local", country: "Local", countryCode: "XX" },
    "::1": { city: "Local", country: "Local", countryCode: "XX" },
  };

  if (mockData[ip]) {
    return mockData[ip];
  }

  // Default mock location
  return {
    city: "San Francisco",
    country: "United States",
    countryCode: "US",
  };
}
