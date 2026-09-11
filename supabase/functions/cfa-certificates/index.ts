import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import * as pdfLib from "pdf-lib";
import { buildCertificatePdf, formatCertificateDate } from "../_shared/certificatePdf.js";
import {
  canIssueCertificate,
  certificateSnapshot,
  certificateStoragePath,
  createCertificateNumber,
} from "../_shared/certificateRecords.js";

const CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd";
const allowedOrigins = new Set([
  "https://learn.centerforanthroposophy.org",
  "https://cfa-website-bqx.pages.dev",
  "http://localhost:4321",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin)
    ? origin
    : "https://learn.centerforanthroposophy.org";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function staffToken(request: Request, url: URL) {
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return bearer || url.searchParams.get("token") || "";
}

function isAuthorizedStaff(request: Request, url: URL) {
  const allowed = (Deno.env.get("CERTIFICATE_ADMIN_TOKENS") || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  return allowed.length > 0 && allowed.includes(staffToken(request, url));
}

function cleanOptional(value: unknown, maximum: number) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  if (clean.length > maximum) throw new Error(`Text must be at most ${maximum} characters`);
  return clean;
}

function awardDate(value: unknown) {
  const clean = String(value || new Date().toISOString().slice(0, 10));
  formatCertificateDate(clean);
  return clean;
}

function safeFilename(value: string) {
  const clean = value.normalize("NFKD").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${clean || "certificate"}.pdf`;
}

async function getAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("server_configuration");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getContext(admin: ReturnType<typeof createClient>, enrollmentId: string, templateId: string) {
  if (!uuidPattern.test(enrollmentId) || !uuidPattern.test(templateId)) throw new Error("invalid_id");
  const [enrollmentResult, templateResult] = await Promise.all([
    admin
      .from("enrollments")
      .select("id, client_id, program_id, contact_id, status, revoked_at")
      .eq("id", enrollmentId)
      .eq("client_id", CFA_CLIENT_ID)
      .maybeSingle(),
    admin
      .from("cfa_certificate_templates")
      .select("id, client_id, program_id, name, version, status, background_bucket, background_path, certificate_title, completion_text, program_title, detail_text, layout, eligibility_ratio")
      .eq("id", templateId)
      .eq("client_id", CFA_CLIENT_ID)
      .maybeSingle(),
  ]);
  if (enrollmentResult.error || templateResult.error) throw new Error("record_lookup_failed");
  const enrollment = enrollmentResult.data;
  const template = templateResult.data;
  if (!enrollment || enrollment.status !== "registered" || enrollment.revoked_at) throw new Error("active_enrollment_required");
  if (!template || template.status !== "active") throw new Error("active_template_required");
  if (template.program_id && template.program_id !== enrollment.program_id) throw new Error("template_program_mismatch");

  const [contactResult, programResult] = await Promise.all([
    admin
      .from("contacts")
      .select("first_name, last_name, email")
      .eq("id", enrollment.contact_id)
      .eq("client_id", CFA_CLIENT_ID)
      .maybeSingle(),
    admin
      .from("programs")
      .select("id, name")
      .eq("id", enrollment.program_id)
      .eq("client_id", CFA_CLIENT_ID)
      .maybeSingle(),
  ]);
  if (contactResult.error || programResult.error || !contactResult.data || !programResult.data) {
    throw new Error("certificate_context_failed");
  }
  return { enrollment, template, contact: contactResult.data, program: programResult.data };
}

async function loadBackground(admin: ReturnType<typeof createClient>, template: Record<string, unknown>) {
  if (!template.background_path) return { bytes: null, mime: null, fallback: true };
  const { data, error } = await admin.storage
    .from(String(template.background_bucket))
    .download(String(template.background_path));
  if (error || !data) return { bytes: null, mime: null, fallback: true };
  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    mime: data.type || (String(template.background_path).toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"),
    fallback: false,
  };
}

async function renderPdf(admin: ReturnType<typeof createClient>, context: Awaited<ReturnType<typeof getContext>>, body: Record<string, unknown>, certificateNumber: string) {
  const recipientName = cleanOptional(body.recipient_name, 160)
    || `${context.contact.first_name || ""} ${context.contact.last_name || ""}`.trim();
  const background = await loadBackground(admin, context.template);
  const bytes = await buildCertificatePdf(pdfLib, {
    recipientName,
    programTitle: cleanOptional(body.program_title, 240)
      || context.template.program_title
      || context.program.name,
    detailText: cleanOptional(body.detail_text, 240) ?? context.template.detail_text,
    awardDate: awardDate(body.award_date),
    certificateNumber,
    certificateTitle: context.template.certificate_title,
    completionText: context.template.completion_text,
    layout: context.template.layout,
    backgroundBytes: background.bytes,
    backgroundMime: background.mime,
  });
  return { bytes, usedFallbackBackground: background.fallback, recipientName };
}

async function listQueue(admin: ReturnType<typeof createClient>, programId: string | null) {
  const [coursesResult, templatesResult] = await Promise.all([
    admin
      .from("cfa_learn_courses")
      .select("program_id, slug, title, published")
      .order("title"),
    admin
      .from("cfa_certificate_templates")
      .select("id, program_id, name, version, status, eligibility_ratio, auto_issue, background_path")
      .eq("client_id", CFA_CLIENT_ID)
      .eq("status", "active")
      .order("name"),
  ]);
  if (coursesResult.error || templatesResult.error) throw new Error("queue_lookup_failed");
  const programs = (coursesResult.data || []).map((course) => ({
    id: course.program_id,
    slug: course.slug,
    name: course.title,
    published: course.published,
  }));
  const templates = templatesResult.data || [];
  if (!programId) return { programs, templates, people: [] };
  if (!uuidPattern.test(programId) || !programs.some((program) => program.id === programId)) {
    throw new Error("invalid_program");
  }

  const { data: enrollments, error: enrollmentError } = await admin
    .from("enrollments")
    .select("id, contact_id, source, enrolled_at")
    .eq("client_id", CFA_CLIENT_ID)
    .eq("program_id", programId)
    .eq("status", "registered")
    .is("revoked_at", null)
    .order("enrolled_at");
  if (enrollmentError) throw new Error("queue_lookup_failed");
  const enrollmentIds = (enrollments || []).map((row) => row.id);
  const contactIds = (enrollments || []).map((row) => row.contact_id);
  const [contactsResult, eligibilityResult, certificatesResult] = await Promise.all([
    contactIds.length
      ? admin.from("contacts").select("id, first_name, last_name, email").eq("client_id", CFA_CLIENT_ID).in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    enrollmentIds.length
      ? admin.from("cfa_certificate_eligibility").select("*").in("enrollment_id", enrollmentIds)
      : Promise.resolve({ data: [], error: null }),
    enrollmentIds.length
      ? admin.from("cfa_certificates").select("id, enrollment_id, template_id, certificate_number, status, award_date, issued_at, revoked_at").in("enrollment_id", enrollmentIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (contactsResult.error || eligibilityResult.error || certificatesResult.error) throw new Error("queue_lookup_failed");
  const contacts = new Map((contactsResult.data || []).map((row) => [row.id, row]));
  const eligibility = new Map((eligibilityResult.data || []).map((row) => [row.enrollment_id, row]));
  const certificates = new Map();
  for (const certificate of certificatesResult.data || []) {
    if (!certificates.has(certificate.enrollment_id)) certificates.set(certificate.enrollment_id, certificate);
  }
  const people = (enrollments || []).map((enrollment) => {
    const contact = contacts.get(enrollment.contact_id);
    return {
      enrollment_id: enrollment.id,
      name: `${contact?.first_name || ""} ${contact?.last_name || ""}`.trim() || "Name missing",
      email: contact?.email || null,
      source: enrollment.source,
      enrolled_at: enrollment.enrolled_at,
      eligibility: eligibility.get(enrollment.id) || null,
      certificate: certificates.get(enrollment.id) || null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { programs, templates, people };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (origin && !allowedOrigins.has(origin)) return json({ error: "origin_not_allowed" }, 403, origin);
  const url = new URL(request.url);
  if (!isAuthorizedStaff(request, url)) return json({ error: "unauthorized" }, 401, origin);

  try {
    const admin = await getAdmin();
    if (request.method === "GET") {
      const action = url.searchParams.get("action") || "queue";
      if (action === "queue") {
        return json(await listQueue(admin, url.searchParams.get("program_id")), 200, origin);
      }
      if (action === "download") {
        const id = url.searchParams.get("id") || "";
        if (!uuidPattern.test(id)) return json({ error: "invalid_id" }, 400, origin);
        const { data: certificate, error } = await admin
          .from("cfa_certificates")
          .select("recipient_name, certificate_number, pdf_bucket, pdf_path, status")
          .eq("id", id)
          .eq("client_id", CFA_CLIENT_ID)
          .maybeSingle();
        if (error || !certificate || certificate.status !== "issued" || !certificate.pdf_path) {
          return json({ error: "certificate_not_found" }, 404, origin);
        }
        const stored = await admin.storage.from(certificate.pdf_bucket).download(certificate.pdf_path);
        if (stored.error || !stored.data) return json({ error: "certificate_file_missing" }, 404, origin);
        return new Response(await stored.data.arrayBuffer(), {
          status: 200,
          headers: {
            ...corsHeaders(origin),
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${safeFilename(`${certificate.recipient_name}-${certificate.certificate_number}`)}"`,
            "Cache-Control": "private, no-store",
          },
        });
      }
      return json({ error: "unknown_action" }, 400, origin);
    }

    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");

    if (action === "set_eligibility") {
      const enrollmentId = String(body.enrollment_id || "");
      if (!uuidPattern.test(enrollmentId)) return json({ error: "invalid_enrollment" }, 400, origin);
      const reviewer = cleanOptional(body.reviewed_by, 120);
      const basis = String(body.basis || "manual_review");
      const eligible = body.eligible === true;
      if (!reviewer) return json({ error: "reviewer_required" }, 400, origin);
      if (!["attendance", "course_completion", "manual_review", "migration"].includes(basis)) {
        return json({ error: "invalid_basis" }, 400, origin);
      }
      const { data: enrollment } = await admin
        .from("enrollments")
        .select("id, client_id, program_id, status, revoked_at")
        .eq("id", enrollmentId)
        .eq("client_id", CFA_CLIENT_ID)
        .maybeSingle();
      if (!enrollment || enrollment.status !== "registered" || enrollment.revoked_at) {
        return json({ error: "active_enrollment_required" }, 400, origin);
      }
      const countable = body.countable_sessions == null ? null : Number(body.countable_sessions);
      const attended = body.attended_sessions == null ? null : Number(body.attended_sessions);
      const ratio = countable && attended != null ? attended / countable : null;
      const { data, error } = await admin.from("cfa_certificate_eligibility").upsert({
        enrollment_id: enrollment.id,
        client_id: CFA_CLIENT_ID,
        program_id: enrollment.program_id,
        eligible,
        basis,
        attended_sessions: attended,
        countable_sessions: countable,
        attendance_ratio: ratio,
        evidence: typeof body.evidence === "object" && body.evidence ? body.evidence : {},
        reviewed_by: reviewer,
        reviewed_at: new Date().toISOString(),
      }, { onConflict: "enrollment_id" }).select().single();
      if (error) return json({ error: "eligibility_update_failed", detail: error.message }, 500, origin);
      return json({ eligibility: data }, 200, origin);
    }

    if (action === "preview" || action === "issue") {
      const enrollmentId = String(body.enrollment_id || "");
      const templateId = String(body.template_id || "");
      const context = await getContext(admin, enrollmentId, templateId);
      if (action === "preview") {
        const rendered = await renderPdf(admin, context, body, "PREVIEW");
        return new Response(rendered.bytes, {
          status: 200,
          headers: {
            ...corsHeaders(origin),
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${safeFilename(`${rendered.recipientName}-preview`)}"`,
            "Cache-Control": "private, no-store",
            "X-CfA-Fallback-Background": rendered.usedFallbackBackground ? "true" : "false",
          },
        });
      }

      const { data: eligibility, error: eligibilityError } = await admin
        .from("cfa_certificate_eligibility")
        .select("*")
        .eq("enrollment_id", enrollmentId)
        .maybeSingle();
      if (eligibilityError || !canIssueCertificate(eligibility)) {
        return json({ error: "eligibility_review_required" }, 409, origin);
      }
      const { data: existing } = await admin
        .from("cfa_certificates")
        .select("id, certificate_number")
        .eq("enrollment_id", enrollmentId)
        .eq("template_id", templateId)
        .eq("status", "issued")
        .maybeSingle();
      if (existing) return json({ error: "already_issued", certificate: existing }, 409, origin);

      const issuedBy = cleanOptional(body.issued_by, 120);
      if (!issuedBy) return json({ error: "issuer_required" }, 400, origin);
      const certificateNumber = createCertificateNumber();
      const recipientName = cleanOptional(body.recipient_name, 160)
        || `${context.contact.first_name || ""} ${context.contact.last_name || ""}`.trim();
      const programTitle = cleanOptional(body.program_title, 240)
        || context.template.program_title
        || context.program.name;
      const detailText = cleanOptional(body.detail_text, 240) ?? context.template.detail_text;
      const date = awardDate(body.award_date);
      const { data: draft, error: draftError } = await admin.from("cfa_certificates").insert({
        client_id: CFA_CLIENT_ID,
        program_id: context.enrollment.program_id,
        enrollment_id: enrollmentId,
        template_id: templateId,
        certificate_number: certificateNumber,
        recipient_name: recipientName,
        program_title: programTitle,
        detail_text: detailText,
        award_date: date,
        template_version: context.template.version,
        eligibility_snapshot: certificateSnapshot(eligibility),
        issued_by: issuedBy,
      }).select("id").single();
      if (draftError || !draft) return json({ error: "certificate_create_failed", detail: draftError?.message }, 500, origin);

      try {
        const rendered = await renderPdf(admin, context, body, certificateNumber);
        const pdfPath = certificateStoragePath(CFA_CLIENT_ID, context.enrollment.program_id, draft.id);
        const uploaded = await admin.storage.from("cfa-certificates").upload(pdfPath, rendered.bytes, {
          contentType: "application/pdf",
          cacheControl: "0",
          upsert: false,
        });
        if (uploaded.error) throw uploaded.error;
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", rendered.bytes));
        const sha256 = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
        const { data: issued, error: issueError } = await admin.from("cfa_certificates").update({
          status: "issued",
          pdf_path: pdfPath,
          pdf_sha256: sha256,
          issued_at: new Date().toISOString(),
        }).eq("id", draft.id).select("id, certificate_number, status, award_date, issued_at").single();
        if (issueError) throw issueError;
        return json({ certificate: issued, used_fallback_background: rendered.usedFallbackBackground }, 201, origin);
      } catch (error) {
        await admin.from("cfa_certificates").update({ status: "failed" }).eq("id", draft.id);
        return json({ error: "certificate_render_failed", detail: error instanceof Error ? error.message : "unknown" }, 500, origin);
      }
    }

    if (action === "revoke") {
      const id = String(body.certificate_id || "");
      const reason = cleanOptional(body.reason, 500);
      const revokedBy = cleanOptional(body.revoked_by, 120);
      if (!uuidPattern.test(id) || !reason || !revokedBy) return json({ error: "revocation_details_required" }, 400, origin);
      const { data, error } = await admin.from("cfa_certificates").update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: revokedBy,
        revocation_reason: reason,
      }).eq("id", id).eq("client_id", CFA_CLIENT_ID).eq("status", "issued").select("id, status, revoked_at").maybeSingle();
      if (error || !data) return json({ error: "issued_certificate_not_found" }, 404, origin);
      return json({ certificate: data }, 200, origin);
    }

    return json({ error: "unknown_action" }, 400, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const clientErrors = new Set([
      "invalid_id",
      "invalid_program",
      "active_enrollment_required",
      "active_template_required",
      "template_program_mismatch",
    ]);
    return json({ error: message }, clientErrors.has(message) ? 400 : 500, origin);
  }
});
