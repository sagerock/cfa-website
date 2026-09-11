const DEFAULT_LAYOUT = Object.freeze({
  page_width: 792,
  page_height: 612,
  name_y: 431,
  name_size: 38,
  program_y: 345,
  program_size: 33,
  detail_y: 307,
  detail_size: 23,
  date_y: 257,
  date_size: 20,
  verification_y: 19,
  verification_size: 7,
  ink: [0.12, 0.08, 0.1],
  accent: [0.31, 0.16, 0.29],
});

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeCertificateLayout(layout = {}) {
  const source = layout && typeof layout === "object" ? layout : {};
  const normalized = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LAYOUT)) {
    if (Array.isArray(fallback)) {
      const candidate = source[key];
      normalized[key] = Array.isArray(candidate)
        && candidate.length === 3
        && candidate.every((part) => Number.isFinite(Number(part)))
        ? candidate.map(Number)
        : [...fallback];
    } else {
      normalized[key] = finiteNumber(source[key], fallback);
    }
  }
  return normalized;
}

export function fitTextSize(font, text, preferredSize, maxWidth, minimumSize = 11) {
  const clean = String(text || "").trim();
  if (!clean) return preferredSize;
  const width = font.widthOfTextAtSize(clean, preferredSize);
  if (width <= maxWidth) return preferredSize;
  return Math.max(minimumSize, preferredSize * (maxWidth / width));
}

export function formatCertificateDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) throw new Error("award_date must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) throw new Error("award_date is not a valid calendar date");
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function validateCertificateInput(input) {
  const recipientName = String(input?.recipientName || "").trim();
  const programTitle = String(input?.programTitle || "").trim();
  const detailText = String(input?.detailText || "").trim();
  const certificateNumber = String(input?.certificateNumber || "PREVIEW").trim();
  if (!recipientName || recipientName.length > 160) throw new Error("recipient_name is required and must be at most 160 characters");
  if (!programTitle || programTitle.length > 240) throw new Error("program_title is required and must be at most 240 characters");
  if (detailText.length > 240) throw new Error("detail_text must be at most 240 characters");
  if (!/^[A-Z0-9-]{3,40}$/i.test(certificateNumber)) throw new Error("certificate_number is invalid");
  return {
    recipientName,
    programTitle,
    detailText: detailText || null,
    certificateNumber,
    awardDate: formatCertificateDate(input?.awardDate),
  };
}

function drawCentered(page, font, text, y, preferredSize, maxWidth, color, minimumSize = 11) {
  const size = fitTextSize(font, text, preferredSize, maxWidth, minimumSize);
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (page.getWidth() - width) / 2,
    y,
    size,
    font,
    color,
  });
}

function drawFallbackBackground(page, pdfLib, layout, title, completionText) {
  const { rgb } = pdfLib;
  const width = page.getWidth();
  const height = page.getHeight();
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.96, 0.9, 0.8) });
  page.drawEllipse({ x: 215, y: 355, xScale: 250, yScale: 190, color: rgb(0.72, 0.84, 0.73), opacity: 0.36 });
  page.drawEllipse({ x: 550, y: 330, xScale: 255, yScale: 210, color: rgb(0.96, 0.65, 0.52), opacity: 0.34 });
  page.drawEllipse({ x: 430, y: 250, xScale: 270, yScale: 190, color: rgb(0.75, 0.72, 0.88), opacity: 0.22 });
  page.drawRectangle({ x: 12, y: 12, width: width - 24, height: height - 24, borderWidth: 24, borderColor: rgb(0.28, 0.14, 0.26), opacity: 0.82 });
  page.drawRectangle({ x: 31, y: 31, width: width - 62, height: height - 62, borderWidth: 3, borderColor: rgb(0.48, 0.37, 0.52), opacity: 0.8 });

  return { title, completionText, layout };
}

export async function buildCertificatePdf(pdfLib, input) {
  const {
    PDFDocument,
    StandardFonts,
    rgb,
  } = pdfLib;
  const values = validateCertificateInput(input);
  const layout = normalizeCertificateLayout(input?.layout);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${values.recipientName} — ${values.programTitle}`);
  pdf.setAuthor("Center for Anthroposophy");
  pdf.setSubject("Certificate of Completion");
  pdf.setCreator("Center for Anthroposophy certificate system");
  const page = pdf.addPage([layout.page_width, layout.page_height]);

  let backgroundDrawn = false;
  if (input?.backgroundBytes?.length) {
    try {
      const mime = String(input.backgroundMime || "image/jpeg").toLowerCase();
      const image = mime === "image/png"
        ? await pdf.embedPng(input.backgroundBytes)
        : await pdf.embedJpg(input.backgroundBytes);
      page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      backgroundDrawn = true;
    } catch {
      backgroundDrawn = false;
    }
  }

  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(...layout.ink);
  const accent = rgb(...layout.accent);
  const title = String(input?.certificateTitle || "Certificate of Completion").trim();
  const completionText = String(input?.completionText || "has successfully completed").trim();

  if (!backgroundDrawn) {
    drawFallbackBackground(page, pdfLib, layout, title, completionText);
    drawCentered(page, italic, title, 500, 38, page.getWidth() - 160, accent, 24);
    drawCentered(page, italic, completionText, 360, 25, page.getWidth() - 220, accent, 16);
    page.drawText("Center", { x: 92, y: 78, size: 19, font: serifBold, color: accent });
    page.drawText("for Anthroposophy", { x: 92, y: 57, size: 14, font: serif, color: accent });
  }

  drawCentered(page, serif, values.recipientName, layout.name_y, layout.name_size, page.getWidth() - 150, ink, 20);
  drawCentered(page, serif, values.programTitle, layout.program_y, layout.program_size, page.getWidth() - 105, ink, 16);
  if (values.detailText) {
    drawCentered(page, serif, values.detailText, layout.detail_y, layout.detail_size, page.getWidth() - 190, ink, 12);
  }
  drawCentered(page, serif, values.awardDate, layout.date_y, layout.date_size, 260, ink, 13);

  const verification = `Certificate ${values.certificateNumber}`;
  drawCentered(
    page,
    sans,
    verification,
    layout.verification_y,
    layout.verification_size,
    page.getWidth() - 80,
    backgroundDrawn ? rgb(0.88, 0.82, 0.88) : accent,
    6,
  );

  return pdf.save({ useObjectStreams: false });
}
