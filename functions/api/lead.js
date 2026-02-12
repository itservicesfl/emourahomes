export async function onRequestPost(context) {
    try {
        const body = await context.request.json();

        // We’ll store Formspree URL in an environment variable
        const FORMSPREE_ENDPOINT = context.env.FORMSPREE_ENDPOINT;
        if (!FORMSPREE_ENDPOINT) {
            return json({ error: "Missing FORMSPREE_ENDPOINT env var" }, 500);
        }

        // Minimal lead validation
        const choice = String(body?.leadChoice || "");
        const lead = body?.lead || {};
        const name = String(lead?.name || "").trim();

        if (!name) return json({ error: "Missing name" }, 400);

        if (choice === "email_report") {
            const email = String(lead?.email || "").trim();
            if (!email || !email.includes("@")) return json({ error: "Invalid email" }, 400);
        }

        if (choice === "specialist_call") {
            const phone = String(lead?.phone || "").trim();
            const best = String(lead?.best || "").trim();
            if (!phone || phone.length < 7) return json({ error: "Invalid phone" }, 400);
            if (!best) return json({ error: "Missing best time" }, 400);
        }

        // Forward payload to Formspree
        // This is what you’ll receive in Formspree submissions.
        const forwardPayload = {
            source: "emourahomevalue.com",
            createdAt: new Date().toISOString(),

            // lead info
            leadChoice: body.leadChoice,
            lead: body.lead,

            // property info
            property: {
                address: body.address,
                ptype: body.ptype,
                sqft: body.sqft,
                beds: body.beds,
                baths: body.baths,
                features: body.features,
                garageSpots: body.garageSpots,
                hoa: body.hoa,
                hoaAmount: body.hoaAmount
            },

            // estimate
            estimate: body.estimate
        };

        const resp = await fetch(FORMSPREE_ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(forwardPayload)
        });

        if (!resp.ok) {
            const txt = await resp.text().catch(() => "");
            return json({ error: "Formspree rejected", status: resp.status, detail: txt.slice(0, 300) }, 502);
        }

        return json({ ok: true }, 200);
    } catch (e) {
        return json({ error: "Bad request", detail: String(e?.message || e) }, 400);
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
