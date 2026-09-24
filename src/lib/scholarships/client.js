// Staged adapter; deliberately NOT imported by the fictional preview.
// Instantiate with a Supabase client only after the backend pilot is verified.
export function scholarshipClient(supabase) {
  return {
    async requestCode(email) {
      const { error } = await supabase.functions.invoke('cfa-scholarship-signin', { body: { email: email.trim().toLowerCase() } });
      if (error) throw new Error('Unable to request a code. Please try again shortly.');
    },
    async verifyCode(email, token) {
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token.trim(), type: 'email' });
      if (error) throw new Error('That code is invalid or has expired. Request a new code.');
      return data;
    },
    async loadApplications() {
      const { data, error } = await supabase.from('cfa_scholarship_applications').select('*').order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    async save(programId, answers, revision = 0, submit = false) {
      const { data, error } = await supabase.rpc('cfa_scholarship_save', { p_program: programId, p_answers: answers, p_revision: revision, p_submit: submit });
      if (error) throw error;
      return data;
    },
    async review(applicationId, action, reason, proposedCents = null) {
      const { data, error } = await supabase.rpc('cfa_scholarship_record_review', { p_application: applicationId, p_action: action, p_reason: reason, p_proposed_cents: proposedCents });
      if (error) throw error;
      return data;
    },
  };
}
