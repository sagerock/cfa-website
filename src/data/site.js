// Backend = the SageRock Email Marketing Tool Supabase, where CfA is already a client.
// Website leads become real, deduped CfA contacts (tagged "website"); analytics land in a
// cfa_-prefixed table. Endpoints are public (validated server-side) so no key ships here.
export const FN = 'https://ckloewflialohuvixmvd.supabase.co/functions/v1';
export const CONTACT_ENDPOINT = `${FN}/cfa-contact`;
export const TRACK_ENDPOINT = `${FN}/cfa-track`;
export const DONATION_CHECKOUT_URL = 'https://centerforanthroposophy.org/make-a-donation/';

export const CONTACT = {
  phone: '603-654-2566',
  phoneHref: '+16036542566',
  email: 'office@centerforanthroposophy.org',
};

// Program options for the contact form's "I'm interested in" field.
export const PROGRAM_OPTIONS = [
  'Explorations Online',
  'Building Bridges',
  'Waldorf High School Teacher Education',
  'Antioch University Program',
  'Kairos Institute',
  'Mentor Training',
  'Renewal Courses',
  'Starlight Rays in Darkened Times',
  'Waldorf Leadership Development',
  "I'm not sure yet",
];
