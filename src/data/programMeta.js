// The real CfA program architecture (per Sage, July 2026) + faculty-tag mapping
// from the old site's EAEL filterable gallery.

export const PROGRAM_GROUPS = [
  { name: 'Introductory', slugs: ['explorations-online', 'building-bridges'] },
  { name: 'Teacher Training', slugs: ['waldorf-high-school', 'antioch-university'] },
  {
    name: 'Professional Development',
    slugs: [
      'kairos-institute',
      'mentor-training',
      'renewal-courses',
      'starlight-rays',
      'waldorf-leadership-development',
    ],
  },
];

export const RESIDENCY_GROUP = {
  name: 'Attending a Residency',
  slugs: ['summer-housing-meals', 'directions-keene'],
};

// site slug -> faculty.json program tag
export const FACULTY_TAG = {
  'explorations-online': 'explorations-online',
  'building-bridges': 'building-bridges',
  'waldorf-high-school': 'waldorf-high-school-teacher-education',
  'antioch-university': 'antioch-university-waldorf-teacher-education',
  'kairos-institute': 'kairos-institute',
  'mentor-training': 'mentor-training',
  'renewal-courses': 'renewal-courses',
  'waldorf-leadership-development': 'waldorf-leadership-development',
};

export const TAG_LABEL = {
  'explorations-online': 'Explorations Online',
  'building-bridges': 'Building Bridges',
  'waldorf-high-school-teacher-education': 'WHS Teacher Education',
  'antioch-university-waldorf-teacher-education': 'Antioch University',
  'kairos-institute': 'Kairos Institute',
  'mentor-training': 'Mentor Training',
  'renewal-courses': 'Renewal Courses',
  'waldorf-leadership-development': 'Leadership Development',
  'program-directors': 'Program Directors',
};
