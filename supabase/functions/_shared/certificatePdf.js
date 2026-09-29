// title_y and completion_y exist because the fallback background drew both at
// hardcoded heights. "has successfully completed" sat at y=360 while the stored
// CfA Classic layout puts the program title at y=345 in 33pt — the title's
// ascenders ran through the completion line and both became unreadable. They are
// layout keys now, and the completion default clears a 33pt program title.
const DEFAULT_LAYOUT = Object.freeze({
  page_width: 792,
  page_height: 612,
  title_y: 500,
  title_size: 38,
  name_y: 431,
  name_size: 38,
  completion_y: 385,
  completion_size: 25,
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

// CfA Classic v1 carries David Barham's and Lisa Mahar's signatures inside the
// artwork, so this block stays empty for that template. It exists for the case
// the artwork cannot cover: a background whose printed title is wrong for the
// program on it (the baked "WHiSTEP Program Director" is not Starlight's title),
// or a design with no signatures at all. Configured per template; drawn only
// when configured, so an unconfigured template renders exactly as it did before.
export function normalizeSignatures(signatures) {
  if (!Array.isArray(signatures)) return [];
  return signatures.slice(0, 4).map((entry, index) => {
    const source = entry && typeof entry === "object" ? entry : {};
    const name = String(source.name || "").trim();
    const title = String(source.title || "").trim();
    if (!name) throw new Error(`signature ${index + 1} requires a name`);
    if (name.length > 120 || title.length > 120) throw new Error(`signature ${index + 1} text is too long`);
    return {
      name,
      title: title || null,
      imagePath: String(source.image_path || "").trim() || null,
      imageBytes: source.imageBytes?.length ? source.imageBytes : null,
      imageMime: source.imageMime || null,
      x: finiteNumber(source.x, 600),
      y: finiteNumber(source.y, 150),
      width: Math.max(40, finiteNumber(source.width, 190)),
      nameSize: finiteNumber(source.name_size, 13),
      titleSize: finiteNumber(source.title_size, 11),
      rule: source.rule !== false,
    };
  });
}

// Layout mirrors the printed artwork: signed ink above the rule, the signer's
// role below it. With no signature image the name goes above the rule instead,
// so the block still reads as a signature line rather than a stray caption.
async function drawSignatures(pdf, page, pdfLib, signatures, fonts, ink) {
  const { rgb } = pdfLib;
  for (const signature of signatures) {
    const half = signature.width / 2;
    let inkDrawn = false;
    if (signature.imageBytes?.length) {
      try {
        const mime = String(signature.imageMime || "image/png").toLowerCase();
        const image = mime === "image/jpeg" || mime === "image/jpg"
          ? await pdf.embedJpg(signature.imageBytes)
          : await pdf.embedPng(signature.imageBytes);
        // Scale to the block width and sit the ink on the rule, never through it.
        const drawWidth = signature.width * 0.86;
        const drawHeight = (image.height / image.width) * drawWidth;
        page.drawImage(image, {
          x: signature.x - drawWidth / 2,
          y: signature.y + 4,
          width: drawWidth,
          height: Math.min(drawHeight, 58),
        });
        inkDrawn = true;
      } catch {
        // A signature image that will not embed must not cost the certificate
        // its name and title; the printed lines still identify the signer.
      }
    }
    if (!inkDrawn) {
      drawCentered(page, fonts.italic, signature.name, signature.y + 10, signature.nameSize + 6, signature.width + 40, ink, 9);
    }
    if (signature.rule) {
      page.drawLine({
        start: { x: signature.x - half, y: signature.y },
        end: { x: signature.x + half, y: signature.y },
        thickness: 0.9,
        color: rgb(0.28, 0.2, 0.26),
      });
    }
    const below = signature.title || (inkDrawn ? signature.name : null);
    if (below) {
      drawCentered(page, fonts.serif, below, signature.y - 15, signature.titleSize, signature.width + 60, ink, 8);
    }
  }
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
    drawCentered(page, italic, title, layout.title_y, layout.title_size, page.getWidth() - 160, accent, 24);
    drawCentered(page, italic, completionText, layout.completion_y, layout.completion_size, page.getWidth() - 220, accent, 16);
    page.drawText("Center", { x: 92, y: 78, size: 19, font: serifBold, color: accent });
    page.drawText("for Anthroposophy", { x: 92, y: 57, size: 14, font: serif, color: accent });
  }

  drawCentered(page, serif, values.recipientName, layout.name_y, layout.name_size, page.getWidth() - 150, ink, 20);
  drawCentered(page, serif, values.programTitle, layout.program_y, layout.program_size, page.getWidth() - 105, ink, 16);
  if (values.detailText) {
    drawCentered(page, serif, values.detailText, layout.detail_y, layout.detail_size, page.getWidth() - 190, ink, 12);
  }
  drawCentered(page, serif, values.awardDate, layout.date_y, layout.date_size, 260, ink, 13);

  const signatures = normalizeSignatures(input?.signatures);
  if (signatures.length) {
    await drawSignatures(pdf, page, pdfLib, signatures, { serif, serifBold, italic, sans }, ink);
  }

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
