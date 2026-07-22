// Central config. The Supabase functions base for this PoC lives in a lightly-used
// SageRock project under a cfa_-prefixed, RLS-locked schema; production would get a
// dedicated project. Endpoints are public (validated server-side) so no key ships here.
export const FN = 'https://dplaqxqnczmnxkuccsph.supabase.co/functions/v1';
export const CONTACT_ENDPOINT = `${FN}/cfa-contact`;
export const TRACK_ENDPOINT = `${FN}/cfa-track`;

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
