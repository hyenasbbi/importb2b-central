import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRole) {
      return json({ error: "Supabase environment is not configured" }, 500);
    }

    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const ownerId = userData.user.id;
    const input = await req.json().catch(() => ({}));

    const title = String(input?.title || "IMPORTB2B · Notificación de prueba").slice(0, 120);
    const body = String(
      input?.body ||
      "Si ves este aviso, las notificaciones del Control Financiero están funcionando."
    ).slice(0, 1000);
    const url = String(input?.url || "/");
    const tag = String(input?.tag || "importb2b-push-test").slice(0, 32);

    const { data: cfg, error: cfgError } = await admin
      .from("importb2b_push_config")
      .select("vapid_public_key,vapid_private_key,subject")
      .eq("id", 1)
      .single();

    if (cfgError || !cfg) {
      return json({ error: cfgError?.message || "Push config not found" }, 500);
    }

    if (!cfg.subject?.startsWith("https://") && !cfg.subject?.startsWith("mailto:")) {
      return json({ error: "VAPID subject inválido", subject: cfg.subject }, 500);
    }

    webpush.setVapidDetails(
      cfg.subject,
      cfg.vapid_public_key,
      cfg.vapid_private_key
    );

    const { data: subscriptions, error: subError } = await admin
      .from("importb2b_push_subscriptions")
      .select("id,endpoint,p256dh,auth,user_agent")
      .eq("owner_id", ownerId)
      .eq("active", true);

    if (subError) return json({ error: subError.message }, 500);

    const payload = JSON.stringify({
      title,
      body,
      url,
      tag,
      data: { test: true, sent_at: new Date().toISOString() }
    });

    const results = [];
    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions || []) {
      try {
        const endpoint = new URL(sub.endpoint);
        const host = endpoint.hostname;
        if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || (endpoint.port && endpoint.port !== "443") || !(host === "fcm.googleapis.com" || host === "jmt17.google.com" || host === "updates.push.services.mozilla.com" || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com"))) {
          failed++;
          results.push({ id: sub.id, ok: false, statusCode: 400, error: "Proveedor push no reconocido" });
          continue;
        }
        const response = await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          payload,
          {
            TTL: 300,
            urgency: "high",
            topic: tag
          }
        );

        sent++;
        results.push({
          id: sub.id,
          ok: true,
          statusCode: response?.statusCode || 201,
          provider: String(sub.endpoint).includes("web.push.apple.com") ? "apple" : "other"
        });
      } catch (error: any) {
        failed++;
        const statusCode = Number(error?.statusCode || error?.status || 0);
        const errorBody = "El proveedor push rechazó el envío";

        results.push({
          id: sub.id,
          ok: false,
          statusCode,
          provider: String(sub.endpoint).includes("web.push.apple.com") ? "apple" : "other",
          error: errorBody.slice(0, 500)
        });

        if (statusCode === 404 || statusCode === 410) {
          await admin
            .from("importb2b_push_subscriptions")
            .update({ active: false })
            .eq("id", sub.id);
        }
      }
    }

    return json({
      ok: sent > 0,
      sent,
      failed,
      devices: subscriptions?.length || 0,
      results
    });
  } catch (error) {
    console.error("push_send_internal_error");
    return json({ error: "Error interno al enviar notificaciones" }, 500);
  }
});
