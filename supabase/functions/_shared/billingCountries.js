// ISO 3166-1 alpha-2 codes. Names are rendered from Intl.DisplayNames at build
// time so this one small list can be shared by the checkout and Edge Function.
export const ISO_COUNTRY_CODES = Object.freeze(`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' '));

export const FEATURED_BILLING_COUNTRY_CODES = Object.freeze(['US', 'CA', 'AU']);

const ISO_COUNTRY_CODE_SET = new Set(ISO_COUNTRY_CODES);

const DEFAULT_RULE = Object.freeze({
  regionLabel: 'State, province, or region',
  postalLabel: 'Postal code',
  regionRequired: false,
  postalRequired: false,
  regionPlaceholder: '',
  postalPlaceholder: '',
});

const RULES = Object.freeze({
  US: Object.freeze({
    regionLabel: 'State',
    postalLabel: 'ZIP code',
    regionRequired: true,
    postalRequired: true,
    regionPlaceholder: 'e.g. NH',
    postalPlaceholder: 'e.g. 03431',
  }),
  CA: Object.freeze({
    regionLabel: 'Province or territory',
    postalLabel: 'Postal code',
    regionRequired: true,
    postalRequired: true,
    regionPlaceholder: 'e.g. ON',
    postalPlaceholder: 'e.g. M5V 3A8',
  }),
  AU: Object.freeze({
    regionLabel: 'State or territory',
    postalLabel: 'Postcode',
    regionRequired: true,
    postalRequired: true,
    regionPlaceholder: 'e.g. NSW',
    postalPlaceholder: 'e.g. 2000',
  }),
});

export function isSupportedBillingCountry(value) {
  return typeof value === 'string' && ISO_COUNTRY_CODE_SET.has(value.trim().toUpperCase());
}

// Spanish labels for the same rules. Only the words change: which fields a
// country requires is a property of the country, not of the reader's language,
// so a Spanish page still requires a US ZIP code.
const ES_LABELS = Object.freeze({
  DEFAULT: Object.freeze({
    regionLabel: 'Estado, provincia o región',
    postalLabel: 'Código postal',
  }),
  US: Object.freeze({ regionLabel: 'Estado', postalLabel: 'Código postal (ZIP)' }),
  CA: Object.freeze({ regionLabel: 'Provincia o territorio', postalLabel: 'Código postal' }),
  AU: Object.freeze({ regionLabel: 'Estado o territorio', postalLabel: 'Código postal' }),
});

function translateRule(rule, code) {
  const labels = ES_LABELS[code] || ES_LABELS.DEFAULT;
  return Object.freeze({
    ...rule,
    regionLabel: labels.regionLabel,
    postalLabel: labels.postalLabel,
    regionPlaceholder: rule.regionPlaceholder.replace('e.g. ', 'ej. '),
    postalPlaceholder: rule.postalPlaceholder.replace('e.g. ', 'ej. '),
  });
}

export function getBillingAddressRule(value, locale = 'en') {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const rule = RULES[code] || DEFAULT_RULE;
  return locale === 'es' ? translateRule(rule, code) : rule;
}

export function hasRequiredBillingAddressFields(address) {
  if (!address || typeof address !== 'object') return false;
  const present = (value) => typeof value === 'string' && value.trim().length > 0;
  const country = present(address.country) ? address.country.trim().toUpperCase() : '';
  if (!present(address.address) || !present(address.city) || !isSupportedBillingCountry(country)) {
    return false;
  }
  const rule = getBillingAddressRule(country);
  return (!rule.regionRequired || present(address.state))
    && (!rule.postalRequired || present(address.zip));
}
