export async function onRequestPost(context) {
    try {
        const body = await context.request.json();

        // Must have D1 binding named DB
        const DB = context.env.DB;
        if (!DB) return json({ error: "Missing D1 binding DB" }, 500);

        // Validate lead
        const leadChoice = String(body?.leadChoice || "");
        const lead = body?.lead || {};
        const name = String(lead?.name || "").trim();

        if (!name) return json({ error: "Missing name" }, 400);
        if (leadChoice !== "email_report" && leadChoice !== "specialist_call") {
            return json({ error: "Invalid leadChoice" }, 400);
        }

        let email = null, phone = null, bestTime = null;

        if (leadChoice === "email_report") {
            email = String(lead?.email || "").trim();
            if (!email || !email.includes("@")) return json({ error: "Invalid email" }, 400);
        }

        if (leadChoice === "specialist_call") {
            phone = String(lead?.phone || "").trim();
            bestTime = String(lead?.best || "").trim();
            if (!phone || phone.length < 7) return json({ error: "Invalid phone" }, 400);
            if (!bestTime) return json({ error: "Missing best time" }, 400);
        }

        // Property + estimate
        const featuresJson = JSON.stringify(body?.features || {});
        const estimate = body?.estimate || {};

        const id = crypto.randomUUID();
        const createdAt = new Date().toISOString();

        // 1) Always insert lead first
        const stmt = DB.prepare(`
      INSERT INTO leads (
        id, created_at,
        lead_choice, name, email, phone, best_time,
        address, ptype, sqft, beds, baths, features_json, garage_spots, hoa, hoa_amount,
        estimate_value, estimate_low, estimate_high, estimate_mode,
        user_agent, ip_country
      ) VALUES (
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `).bind(
            id, createdAt,
            leadChoice, name, email, phone, bestTime,
            body?.address || null,
            body?.ptype || null,
            toInt(body?.sqft),
            toNum(body?.beds),
            toNum(body?.baths),
            featuresJson,
            toInt(body?.garageSpots),
            body?.hoa || null,
            toInt(body?.hoaAmount),
            toInt(estimate?.value),
            toInt(estimate?.low),
            toInt(estimate?.high),
            estimate?.mode || null,
            context.request.headers.get("user-agent") || null,
            context.request.cf?.country || null
        );

        await stmt.run();

        // 2) Try email notification + send report to the lead (never block success if email fails)
        let emailSent = 0;
        let emailError = null;

        try {
            const apiKey = context.env.RESEND_API_KEY;
            const adminTo = context.env.LEADS_NOTIFY_TO;       // your email
            const from = context.env.LEADS_NOTIFY_FROM;        // verified sender
            const siteUrl = context.env.PUBLIC_SITE_URL || "https://emourahomevalue.com";

            if (!apiKey) throw new Error("Missing RESEND_API_KEY");
            if (!adminTo) throw new Error("Missing LEADS_NOTIFY_TO");
            if (!from) throw new Error("Missing LEADS_NOTIFY_FROM");

            const addr = body?.address || "";
            const ptype = body?.ptype || "";
            const sqft = body?.sqft || "";
            const beds = body?.beds || "";
            const baths = body?.baths || "";

            const estVal = estimate?.value ? `$${Number(estimate.value).toLocaleString("en-US")}` : "N/A";
            const estLow = estimate?.low ? `$${Number(estimate.low).toLocaleString("en-US")}` : "N/A";
            const estHigh = estimate?.high ? `$${Number(estimate.high).toLocaleString("en-US")}` : "N/A";

            // Build a simple "report" body
            const reportText =
                `Your Home Value Report

Address: ${addr}
Property type: ${ptype}
Sqft: ${sqft}
Beds/Baths: ${beds} / ${baths}

Estimated value: ${estVal}
Estimated range: ${estLow} – ${estHigh}

Next steps:
- Schedule a call: ${siteUrl}
- Visit our main website: https://www.emourahomes.com

Disclaimer:
This is an estimate based on information provided and market averages. A full comparative market analysis (CMA) may produce a different value.
`;

            const reportHtml = `
    <h2>Your Home Value Report</h2>
    <p>
      <b>Address:</b> ${escapeHtml(addr)}<br/>
      <b>Property type:</b> ${escapeHtml(ptype)}<br/>
      <b>Sqft:</b> ${escapeHtml(String(sqft))}<br/>
      <b>Beds/Baths:</b> ${escapeHtml(String(beds))} / ${escapeHtml(String(baths))}
    </p>

    <p>
      <b>Estimated value:</b> ${escapeHtml(estVal)}<br/>
      <b>Estimated range:</b> ${escapeHtml(estLow)} – ${escapeHtml(estHigh)}
    </p>

    <p>
      <b>Next steps</b><br/>
      • Visit our main website: <a href="https://www.emourahomes.com">www.emourahomes.com</a>
    </p>

    <p style="color:#6b7280;font-size:12px;">
      <b>Disclaimer:</b> This is an estimate based on information provided and market averages.
      A full comparative market analysis (CMA) may produce a different value.
    </p>
  `;

            // Send the report to the LEAD (only if leadChoice is email_report)
            if (leadChoice === "email_report" && email) {
                await sendLeadEmail({
                    apiKey,
                    to: email,
                    from,
                    subject: `Your Home Value Report — ${addr || "Property"}`,
                    text: reportText,
                    html: reportHtml,
                    replyTo: adminTo // optional: when they reply, it goes to you
                });
            }

            // Send admin notification (always)
            const adminText =
                `New lead received

Name: ${name}
Choice: ${leadChoice}
Email: ${email || ""}
Phone: ${phone || ""}
Best time: ${bestTime || ""}

--- Report Copy ---
${reportText}

Lead ID: ${id}
Created: ${createdAt}
`;

            await sendLeadEmail({
                apiKey,
                to: adminTo,
                from,
                subject: `New lead — ${leadChoice} — ${addr || "No address"}`,
                text: adminText,
                html: `<pre style="font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap;">${escapeHtml(adminText)}</pre>`
            });

            emailSent = 1;
        } catch (e) {
            emailError = String(e?.message || e).slice(0, 500);
        }


        // 3) Store email status IF the columns exist; otherwise ignore safely
        // IMPORTANT: This will fail if you didn't add email_sent/email_error columns
        try {
            await DB.prepare(`UPDATE leads SET email_sent=?, email_error=? WHERE id=?`)
                .bind(emailSent, emailError, id)
                .run();
        } catch (_) {
            // Table doesn't have these columns yet — do not break lead capture.
            // (You can add them later with ALTER TABLE.)
        }

        // Always return OK; optionally include email status for debugging
        return json({ ok: true, id, emailSent }, 200);

    } catch (e) {
        return json({ error: "Bad request", detail: String(e?.message || e) }, 400);
    }
}

function toInt(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (Number.isNaN(n)) return null;
    return Math.round(n);
}
function toNum(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (Number.isNaN(n)) return null;
    return n;
}

async function sendLeadEmail({ apiKey, to, from, subject, text, html, replyTo }) {
    const payload = { from, to, subject, text };
    if (html) payload.html = html;
    if (replyTo) payload.reply_to = replyTo;

    const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "content-type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`Resend failed: ${resp.status} ${detail.slice(0, 300)}`);
    }
}


function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store"
        }
    });
}
