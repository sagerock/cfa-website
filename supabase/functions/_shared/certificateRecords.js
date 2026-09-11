export function createCertificateNumber(now = new Date(), randomUuid = crypto.randomUUID()) {
  const year = now.getUTCFullYear();
  const suffix = String(randomUuid).replace(/-/g, "").slice(0, 10).toUpperCase();
  if (!/^\d{4}$/.test(String(year)) || !/^[A-F0-9]{10}$/.test(suffix)) {
    throw new Error("Could not create certificate number");
  }
  return `CFA-${year}-${suffix}`;
}

export function certificateStoragePath(clientId, programId, certificateId) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const [label, value] of Object.entries({ clientId, programId, certificateId })) {
    if (!uuid.test(String(value))) throw new Error(`${label} must be a UUID`);
  }
  return `${clientId}/${programId}/${certificateId}.pdf`;
}

export function canIssueCertificate(eligibility) {
  return Boolean(
    eligibility
    && eligibility.eligible === true
    && eligibility.reviewed_at
    && ["attendance", "course_completion", "manual_review", "migration"].includes(eligibility.basis),
  );
}

export function certificateSnapshot(eligibility) {
  if (!canIssueCertificate(eligibility)) throw new Error("Enrollment is not certificate-eligible");
  return {
    basis: eligibility.basis,
    attended_sessions: eligibility.attended_sessions ?? null,
    countable_sessions: eligibility.countable_sessions ?? null,
    attendance_ratio: eligibility.attendance_ratio ?? null,
    evidence: eligibility.evidence && typeof eligibility.evidence === "object"
      ? eligibility.evidence
      : {},
    reviewed_by: eligibility.reviewed_by ?? null,
    reviewed_at: eligibility.reviewed_at,
  };
}
