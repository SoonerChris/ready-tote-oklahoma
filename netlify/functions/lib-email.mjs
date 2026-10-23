// Shared look for every email the site sends, matching the admin pages:
// a cream frame around a white sheet, ink text, near-black buttons, pale
// status pills, sentence case, no emoji.
//
// Email clients ignore <style> blocks and most CSS, so everything here is
// inline styles on tables. Barlow loads where the client allows web fonts
// (Apple Mail, iOS); everywhere else falls back to Arial.

export const SITE_URL = "https://www.readytoteokc.com";
export const LOGO_URL = `${SITE_URL}/images/logo.png`;
export const PHONE_DISPLAY = "580.399.3202";
export const PHONE_TEL = "+15803993202";

const C = {
  frame: "#F5F1E7",
  sheet: "#FFFFFF",
  line: "#E5DFD2",
  ink: "#1E1B18",
  steel: "#6B6259",
  muted: "#9A938A",
  gold: "#8A6819",
};
const FONT = "'Barlow', Arial, Helvetica, sans-serif";

const PILLS = {
  green: { bg: "#E3F4E9", fg: "#14492F" },
  red: { bg: "#FFEDEA", fg: "#831C1E" },
  gold: { bg: "#FBF0D6", fg: "#6B4C0C" },
  plain: { bg: "#F5F1E7", fg: "#6B6259" },
};

export function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// The whole email. `preheader` is the grey preview line inbox lists show;
// `footer` false drops the customer footer (owner-only emails).
export function emailLayout({ preheader = "", body, footer = true }) {
  const foot = footer ? `
        <tr>
          <td align="center" style="padding:22px 24px 0; font-family:${FONT}; font-size:12px; line-height:1.6; color:${C.steel};">
            <strong style="color:${C.ink};">Ready Tote Oklahoma</strong><br>
            We drop off. You pack. We pick up.<br>
            Serving the OKC metro and Ada area<br>
            <a href="tel:${PHONE_TEL}" style="color:${C.gold}; text-decoration:none;">${PHONE_DISPLAY}</a>
            &nbsp;&middot;&nbsp;
            <a href="${SITE_URL}" style="color:${C.gold}; text-decoration:none;">readytoteokc.com</a>
          </td>
        </tr>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light only">
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0; padding:0; background-color:${C.frame};">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.frame};">
    <tr><td align="center" style="padding:28px 12px 36px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">
        <tr>
          <td style="padding:0 4px 14px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:10px;"><img src="${LOGO_URL}" alt="" width="36" height="36" style="display:block; width:36px; height:36px; border-radius:8px;"></td>
                <td style="font-family:'Archivo Black', 'Arial Black', Arial, sans-serif; font-size:16px; color:${C.ink}; letter-spacing:-0.2px;">Ready Tote Oklahoma</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background-color:${C.sheet}; border:1px solid ${C.line}; border-radius:14px; padding:32px 28px; font-family:${FONT}; color:${C.ink};">
${body}
          </td>
        </tr>${foot}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function pill(text, tone = "plain") {
  const p = PILLS[tone] || PILLS.plain;
  return `<span style="display:inline-block; background-color:${p.bg}; color:${p.fg}; font-family:${FONT}; font-size:12px; font-weight:700; line-height:1; padding:6px 10px; border-radius:999px;">${text}</span>`;
}

// Big title with an optional pill above it and a short lead paragraph below.
export function heading(title, { lead = "", badge = "" } = {}) {
  return `
            ${badge ? `<div style="margin:0 0 12px;">${badge}</div>` : ""}
            <h1 style="margin:0 0 8px; font-family:${FONT}; font-size:26px; line-height:1.2; font-weight:700; color:${C.ink};">${title}</h1>
            ${lead ? `<p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:${C.steel};">${lead}</p>` : ""}`;
}

export function sectionLabel(text, { top = 0 } = {}) {
  return `<p style="margin:${top}px 0 10px; font-family:${FONT}; font-size:13px; font-weight:700; color:${C.gold};">${text}</p>`;
}

// Label / value rows in a bordered box, with an optional total line.
export function detailsCard({ label = "", rows = [], total = null }) {
  const rowHtml = rows.filter(Boolean).map(([k, v], i) => `
                <tr>
                  <td style="padding:10px 0; ${i ? `border-top:1px solid ${C.line};` : ""} font-size:14px; color:${C.steel}; width:140px; vertical-align:top;">${k}</td>
                  <td style="padding:10px 0; ${i ? `border-top:1px solid ${C.line};` : ""} font-size:14px; color:${C.ink}; font-weight:600;">${v}</td>
                </tr>`).join("");
  const totalHtml = total ? `
                <tr>
                  <td style="padding:14px 0 0; border-top:2px solid ${C.ink}; font-size:15px; font-weight:700; color:${C.ink};">${total[0]}</td>
                  <td align="right" style="padding:14px 0 0; border-top:2px solid ${C.ink}; font-size:24px; font-weight:700; color:${C.ink}; font-variant-numeric:tabular-nums;">${total[1]}</td>
                </tr>` : "";
  return `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line}; border-radius:12px;">
              <tr><td style="padding:18px 20px;">
                ${label ? sectionLabel(label) : ""}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONT};">${rowHtml}${totalHtml}
                </table>
              </td></tr>
            </table>`;
}

export function button(href, text, { note = "" } = {}) {
  return `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 ${note ? 8 : 24}px;">
              <tr><td align="center">
                <a href="${href}" style="display:inline-block; background-color:${C.ink}; color:#FFFFFF; font-family:${FONT}; font-size:16px; font-weight:700; text-decoration:none; padding:15px 36px; border-radius:10px;">${text}</a>
              </td></tr>
            </table>
            ${note ? `<p style="margin:0 0 24px; font-size:12px; color:${C.muted}; text-align:center;">${note}</p>` : ""}`;
}

// Numbered "what happens next" list.
export function steps(items, { label = "What happens next", top = 28 } = {}) {
  const rows = items.map((t, i) => `
              <tr>
                <td valign="top" style="padding:6px 12px 6px 0;">
                  <div style="width:24px; height:24px; line-height:24px; border-radius:999px; background-color:${C.frame}; color:${C.ink}; font-size:12px; font-weight:700; text-align:center;">${i + 1}</div>
                </td>
                <td style="padding:8px 0; font-size:14px; line-height:1.5; color:${C.ink};">${t}</td>
              </tr>`).join("");
  return `
            ${sectionLabel(label, { top })}
            <table role="presentation" cellpadding="0" cellspacing="0" style="font-family:${FONT};">${rows}
            </table>`;
}

// Tinted callout box. tone: plain | gold | green | red
export function callout(html, tone = "plain") {
  const p = PILLS[tone] || PILLS.plain;
  return `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px; background-color:${p.bg}; border-radius:12px;">
              <tr><td style="padding:14px 18px; font-family:${FONT}; font-size:14px; line-height:1.6; color:${tone === "plain" ? C.ink : p.fg};">${html}</td></tr>
            </table>`;
}

// "Good to know" box: a short bulleted list in a tinted callout.
export function goodToKnow(items, { label = "Good to know" } = {}) {
  const lis = items.filter(Boolean).map((t) => `<li style="margin:0 0 6px;">${t}</li>`).join("");
  return `
            ${sectionLabel(label, { top: 28 })}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.frame}; border-radius:12px;">
              <tr><td style="padding:14px 18px 8px; font-family:${FONT}; font-size:14px; line-height:1.5; color:${C.ink};">
                <ul style="margin:0; padding-left:18px;">${lis}</ul>
              </td></tr>
            </table>`;
}

// Plain-text copy of an email, sent alongside the HTML. Mail apps that
// prefer text show it, and spam filters trust mail that has both.
export function htmlToText(html) {
  return String(html)
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/<div style="display:none[^>]*>[\s\S]*?<\/div>/i, "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, text) => {
      const t = text.replace(/<[^>]+>/g, "").trim();
      return /^(tel|mailto):/.test(href) || href.replace(/^https?:\/\/(www\.)?/, "").startsWith(t) ? t : `${t}: ${href}`;
    })
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<(br|\/p|\/h1|\/li|\/tr|\/div)[^>]*>/gi, "\n")
    .replace(/<\/td>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&middot;/g, "·").replace(/&minus;/g, "-")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Price breakdown saved with a rental: [{ label, amount }], e.g. package,
// rush fee, military discount. Anything malformed is dropped, so a bad
// value can never break or pad an invoice.
export function cleanLineItems(raw) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6) return null;
  const items = raw.map(i => ({ label: String(i?.label ?? "").trim().slice(0, 60), amount: Number(i?.amount) }))
    .filter(i => i.label && Number.isFinite(i.amount) && Math.abs(i.amount) < 100000);
  return items.length === raw.length ? items : null;
}

// Line items as detailsCard rows: the first plain, the rest signed. Pass
// the price to show them only when they add up to it.
export function lineItemRows(items, price) {
  if (price !== undefined) {
    const p = parseFloat(String(price ?? "").replace(/[^0-9.]/g, ""));
    const sum = (items || []).reduce((t, i) => t + i.amount, 0);
    if (!Number.isFinite(p) || Math.abs(sum - p) >= 0.01) return [];
  }
  return (items || []).map((i, n) => [
    escapeHtml(i.label),
    `${n === 0 ? "" : i.amount < 0 ? "&minus;" : "+"}$${Math.abs(i.amount).toFixed(2)}`,
  ]);
}

// "Questions? Reply or call" line that closes customer emails.
export function contactLine(prefix = "Questions?") {
  return `
            <p style="margin:24px 0 0; padding-top:20px; border-top:1px solid ${C.line}; font-size:14px; line-height:1.6; color:${C.steel};">
              ${prefix} Reply to this email or call
              <a href="tel:${PHONE_TEL}" style="color:${C.ink}; font-weight:700; text-decoration:none;">${PHONE_DISPLAY}</a>.
            </p>`;
}

export const emailColors = C;
export const emailFont = FONT;
