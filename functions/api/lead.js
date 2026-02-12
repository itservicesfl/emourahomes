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
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store"
        }
    });
}
