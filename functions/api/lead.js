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
        // Email notification (do NOT block saving the lead if email fails)
        try {
            const apiKey = context.env.RESEND_API_KEY;
            const to = context.env.LEADS_NOTIFY_TO;
            const from = context.env.LEADS_NOTIFY_FROM;

            if (apiKey && to && from) {
                const addr = body?.address || "(no address)";
                const choice = leadChoice === "email_report" ? "Email report" : "Specialist call";

                const estVal = estimate?.value ? `$${Number(estimate.value).toLocaleString("en-US")}` : "N/A";
                const estLow = estimate?.low ? `$${Number(estimate.low).toLocaleString("en-US")}` : "N/A";
                const estHigh = estimate?.high ? `$${Number(estimate.high).toLocaleString("en-US")}` : "N/A";

                const subject = `New EMoura Home Value lead — ${choice}`;
                const text =
                    `New lead received

Name: ${name}
Choice: ${choice}
Email: ${email || ""}
Phone: ${phone || ""}
Best time: ${bestTime || ""}

Address: ${addr}
Type: ${body?.ptype || ""}
Sqft: ${body?.sqft || ""}
Beds/Baths: ${body?.beds || ""} / ${body?.baths || ""}
Garage: ${body?.garageSpots ?? ""}
HOA: ${body?.hoa || ""} ${body?.hoaAmount ? `($${body.hoaAmount}/mo)` : ""}

Estimate: ${estVal} (range ${estLow}–${estHigh})
Lead ID: ${id}
Created: ${createdAt}
`;

                const html = `
      <h2>New lead received</h2>
      <p><b>Name:</b> ${escapeHtml(name)}<br/>
      <b>Choice:</b> ${escapeHtml(choice)}<br/>
      <b>Email:</b> ${escapeHtml(email || "")}<br/>
      <b>Phone:</b> ${escapeHtml(phone || "")}<br/>
      <b>Best time:</b> ${escapeHtml(bestTime || "")}</p>

      <p><b>Address:</b> ${escapeHtml(addr)}<br/>
      <b>Type:</b> ${escapeHtml(body?.ptype || "")}<br/>
      <b>Sqft:</b> ${escapeHtml(String(body?.sqft || ""))}<br/>
      <b>Beds/Baths:</b> ${escapeHtml(String(body?.beds || ""))} / ${escapeHtml(String(body?.baths || ""))}<br/>
      <b>Garage:</b> ${escapeHtml(String(body?.garageSpots ?? ""))}<br/>
      <b>HOA:</b> ${escapeHtml(String(body?.hoa || ""))} ${body?.hoaAmount ? `($${Number(body.hoaAmount).toLocaleString("en-US")}/mo)` : ""}</p>

      <p><b>Estimate:</b> ${escapeHtml(estVal)} (range ${escapeHtml(estLow)}–${escapeHtml(estHigh)})</p>
      <p><b>Lead ID:</b> ${escapeHtml(id)}<br/>
      <b>Created:</b> ${escapeHtml(createdAt)}</p>
    `;

                await sendLeadEmail({ apiKey, to, from, subject, text, html });
            }
        } catch (e) {
            // Don’t fail the request — lead is already saved.
            // Optional: console.log(e) (but avoid logging PII)
        }


        return json({ ok: true, id }, 200);
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

async function sendLeadEmail({ apiKey, to, from, subject, text, html }) {
    const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "content-type": "application/json"
        },
        body: JSON.stringify({ from, to, subject, text, html })
    });

    if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`Resend failed: ${resp.status} ${detail.slice(0, 300)}`);
    }
}

function escapeHtml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
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
