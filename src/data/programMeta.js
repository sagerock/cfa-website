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

// One-line descriptions, grounded in each program's real page copy.
export const BLURB = {
  'explorations-online':
    'Deepen your connection to the spiritual, artistic, and human dimensions of Waldorf education — a convenient online program.',
  'building-bridges':
    'Discover the anthroposophical foundations of Waldorf education through engaging summer workshops.',
  'waldorf-high-school':
    'Low-residency certification for high school teachers advancing Waldorf pedagogy with purpose.',
  'antioch-university':
    'Elementary Waldorf teacher education in partnership with Antioch University New England.',
  'kairos-institute':
    'Courses for the public and career training in artistic therapy and trauma-informed pedagogy.',
  'mentor-training':
    'Bring the wisdom of your teaching experience into a new role of service through certified mentorship.',
  'renewal-courses':
    'Week-long, certificate-earning summer courses to nourish body, soul, and spirit.',
  'starlight-rays':
    'An online seminar series on contemporary topics for high school teachers, staff, and parents.',
  'waldorf-leadership-development':
    'Preparing leaders and administrators to carry the life of a Waldorf school.',
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
