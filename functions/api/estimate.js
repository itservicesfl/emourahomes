export async function onRequestPost(context) {
    try {
        const body = await context.request.json();

        // Basic validation (MVP)
        const sqft = Number(body?.sqft);
        const ptype = String(body?.ptype || "");
        if (!sqft || Number.isNaN(sqft) || sqft < 200) {
            return json({ error: "Invalid sqft" }, 400);
        }

        // NATIONAL BASELINE (temporary — later we'll use zip-level KV data)
        // You can tune these numbers any time.
        let basePPSF = 240;
        if (ptype.toLowerCase().includes("condo")) basePPSF = 260;

        let val = sqft * basePPSF;

        const features = body?.features || {};
        const garageSpots = body?.garageSpots;

        // Feature adjustments (simple + explainable)
        if (features.pool) val *= 1.05;
        if (features.balcony) val *= 1.02;
        if (features.kitchen) val *= 1.03;

        if (garageSpots === 1) val *= 1.01;
        if (garageSpots === 2) val *= 1.02;
        if (garageSpots === 3) val *= 1.03;

        // HOA adjustment (simple placeholder)
        if (body?.hoa === "yes" && body?.hoaAmount) {
            const hoa = Number(body.hoaAmount);
            if (!Number.isNaN(hoa)) {
                if (hoa > 1200) val *= 0.97;
                else if (hoa > 700) val *= 0.985;
            }
        }

        const low = val * 0.92;
        const high = val * 1.08;

        return json(
            {
                value: Math.round(val),
                low: Math.round(low),
                high: Math.round(high),
                mode: "baseline_v1"
            },
            200
        );
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
