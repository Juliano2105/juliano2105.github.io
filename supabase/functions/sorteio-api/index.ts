// ============================================================
// EDGE FUNCTION: sorteio-api
// Backend completo do sistema Gire & Ganhe
// Deploy: supabase functions deploy sorteio-api
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-admin-token",
  "Content-Type": "application/json",
};

function supabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}
function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: true, message: msg }), { status, headers: CORS });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/v1\/sorteio-api/, "");
  const db = supabase();

  try {
    // ============================================================
    // ROTA: GET /campaigns/:id/public — Dados públicos da campanha
    // ============================================================
    if (req.method === "GET" && path.match(/^\/campaigns\/[\w-]+\/public$/)) {
      const id = path.split("/")[2];
      const { data, error } = await db.from("campaigns").select("*").eq("id", id).eq("active", true).single();
      if (error || !data) return err("Campanha não encontrada", 404);
      return ok({
        id: data.id, name: data.name, title: data.title,
        description: data.description, whatsapp_group_link: data.whatsapp_group_link,
      });
    }

    // ============================================================
    // ROTA: GET /campaigns/:id/roulette-display — Segmentos para exibir
    // (mostra todos os segmentos, sem revelar probabilidades reais)
    // ============================================================
    if (req.method === "GET" && path.match(/^\/campaigns\/[\w-]+\/roulette-display$/)) {
      const id = path.split("/")[2];
      const { data } = await db.from("prizes")
        .select("label, color, icon")
        .eq("campaign_id", id).eq("active", true).order("weight", { ascending: false });
      return ok({ segments: data || [] });
    }

    // ============================================================
    // ROTA: POST /participants/check — Verifica cooldown 24h
    // ============================================================
    if (req.method === "POST" && path === "/participants/check") {
      const { phone, campaign_id } = await req.json();
      if (!phone || !campaign_id) return err("Dados obrigatórios ausentes");

      const { data: participant } = await db.from("participants")
        .select("*").eq("phone", phone).eq("campaign_id", campaign_id).single();

      const now = new Date();
      if (participant?.next_allowed_at && new Date(participant.next_allowed_at) > now) {
        return ok({ status: "cooldown", next_allowed_at: participant.next_allowed_at });
      }

      // Cria/atualiza sessão
      const { data: session } = await db.from("sessions").insert({
        phone, campaign_id,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }).select().single();

      return ok({ status: "ok", session_token: session?.session_token });
    }

    // ============================================================
    // ROTA: POST /participants/whatsapp-click — Registra clique WA
    // ============================================================
    if (req.method === "POST" && path === "/participants/whatsapp-click") {
      const { phone, session_token, campaign_id } = await req.json();
      await db.from("sessions").update({
        whatsapp_click: true, whatsapp_clicked_at: new Date().toISOString(), status: "pending"
      }).eq("session_token", session_token).eq("phone", phone);
      return ok({ ok: true });
    }

    // ============================================================
    // ROTA: GET /participants/check-join — Polling de entrada no grupo
    // ============================================================
    if (req.method === "GET" && path === "/participants/check-join") {
      const phone = url.searchParams.get("phone") || "";
      const campaign_id = url.searchParams.get("campaign_id") || "";
      const session_token = url.searchParams.get("session_token") || "";

      // Verifica se sessão ainda é válida
      const { data: session } = await db.from("sessions")
        .select("*").eq("session_token", session_token).eq("phone", phone).single();
      if (!session) return err("Sessão inválida", 401);
      if (new Date(session.expires_at) < new Date()) return err("Sessão expirada", 401);
      if (session.status === "played") return err("Já jogou nesta sessão", 409);

      // Verifica evento de entrada no grupo
      const { data: campaign } = await db.from("campaigns").select("whatsapp_group_id").eq("id", campaign_id).single();
      const groupId = campaign?.whatsapp_group_id;

      const { data: joinEvent } = await db.from("whatsapp_events")
        .select("*")
        .eq("phone", phone)
        .eq("event_type", "group_join")
        .eq("group_id", groupId || "")
        .gte("created_at", session.created_at)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (joinEvent) {
        // Confirma no banco
        await db.from("sessions").update({ status: "joined" }).eq("session_token", session_token);
        await db.from("participants").upsert({
          phone, campaign_id, joined_group: true, joined_at: joinEvent.created_at
        }, { onConflict: "phone,campaign_id" });
        return ok({ joined: true });
      }
      return ok({ joined: false });
    }

    // ============================================================
    // ROTA: POST /spin — SORTEIA O PRÊMIO (lógica principal)
    // Toda a decisão ocorre aqui. NUNCA no frontend.
    // ============================================================
    if (req.method === "POST" && path === "/spin") {
      const { phone, session_token, campaign_id } = await req.json();

      // 1. Valida sessão
      const { data: session } = await db.from("sessions")
        .select("*").eq("session_token", session_token).eq("phone", phone).single();
      if (!session) return err("Sessão inválida", 401);
      if (session.status !== "joined") return err("Entrada no grupo não confirmada", 403);
      if (session.status === "played") return err("Já jogou nesta sessão", 409);
      if (new Date(session.expires_at) < new Date()) return err("Sessão expirada", 401);

      // 2. Valida cooldown 24h
      const { data: participant } = await db.from("participants")
        .select("*").eq("phone", phone).eq("campaign_id", campaign_id).single();
      if (participant?.next_allowed_at && new Date(participant.next_allowed_at) > new Date()) {
        return err("Cooldown ativo. Tente novamente após 24h.", 429);
      }

      // 3. Busca todos os prêmios da campanha
      const { data: allPrizes } = await db.from("prizes")
        .select("*").eq("campaign_id", campaign_id).eq("active", true);
      if (!allPrizes?.length) return err("Nenhum prêmio configurado", 500);

      // 4. Determina prêmios elegíveis usando lógica inteligente anti-fraude
      const now = new Date();
      const nowTime = now.getHours() * 60 + now.getMinutes(); // minutos desde meia-noite
      const today = now.toISOString().split("T")[0];

      // Reset contadores diários se necessário
      await db.rpc("reset_daily_prize_counters");

      const eligiblePrizes = allPrizes.filter(p => {
        // Fillers sempre elegíveis
        if (p.is_filler) return true;
        // Estoque total
        if (p.stock_total > 0 && p.stock_remaining <= 0) return false;
        // Limite diário
        if (p.daily_limit > 0) {
          const todayCount = p.today_date === today ? p.today_awarded : 0;
          if (todayCount >= p.daily_limit) return false;
        }
        // Horário permitido
        if (p.allowed_from && p.allowed_until) {
          const [fH, fM] = (p.allowed_from as string).split(":").map(Number);
          const [uH, uM] = (p.allowed_until as string).split(":").map(Number);
          const from = fH * 60 + fM;
          const until = uH * 60 + uM;
          if (nowTime < from || nowTime > until) return false;
        }
        // Intervalo mínimo
        if (p.min_interval_minutes > 0 && p.last_awarded_at) {
          const minsSinceLast = (now.getTime() - new Date(p.last_awarded_at).getTime()) / 60000;
          if (minsSinceLast < p.min_interval_minutes) return false;
        }
        return true;
      });

      // 5. Algoritmo de seleção com distribuição temporal inteligente
      // Aplica entropia baseada em: hora atual, segundos, hash do telefone, saldo restante
      const phoneHash = phone.split("").reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
      const entropyFactor = (now.getSeconds() * phoneHash * 7 + now.getMilliseconds() * 13) % 1000;

      // Separa prêmios reais e fillers
      const realPrizes = eligiblePrizes.filter(p => !p.is_filler);
      const fillerPrizes = allPrizes.filter(p => p.is_filler);

      // Decide se um prêmio real deve sair agora
      // Fatores: proporção de prêmios restantes vs tempo restante no dia
      let selectedPrize = null;
      if (realPrizes.length > 0) {
        const campaign = (await db.from("campaigns").select("store_open_time, store_close_time").eq("id", campaign_id).single()).data;
        const [openH, openM] = (campaign?.store_open_time || "09:00").split(":").map(Number);
        const [closeH, closeM] = (campaign?.store_close_time || "18:00").split(":").map(Number);
        const openMin = openH * 60 + openM;
        const closeMin = closeH * 60 + closeM;
        const totalMin = closeMin - openMin;
        const elapsedMin = Math.max(0, nowTime - openMin);
        const timeProgress = Math.min(1, elapsedMin / totalMin); // 0.0 a 1.0

        // Calcula "urgência" de cada prêmio real
        // Prêmios com muito estoque restante ficam mais urgentes conforme o dia avança
        const scoredPrizes = realPrizes.map(p => {
          const stockRatio = p.stock_total > 0 ? p.stock_remaining / p.stock_total : 0.5;
          const dailyRatio = p.daily_limit > 0
            ? 1 - (p.today_awarded || 0) / p.daily_limit
            : 0.3;
          // Score base: quanto mais tarde e mais estoque sobrando, maior urgência
          const urgency = (stockRatio * 0.4 + dailyRatio * 0.4 + timeProgress * 0.2);
          // Adiciona variação pseudo-aleatória não previsível
          const noise = ((entropyFactor + p.weight * phoneHash) % 100) / 100 * 0.35;
          return { prize: p, score: urgency + noise };
        });

        // Threshold dinâmico: aumenta conforme o dia avança para garantir distribuição
        const threshold = 0.35 + timeProgress * 0.25;
        const highScorePrizes = scoredPrizes.filter(s => s.score >= threshold);

        if (highScorePrizes.length > 0) {
          // Escolhe aleatoriamente entre os elegíveis (sem padrão fixo)
          const pick = highScorePrizes[Math.floor((entropyFactor / 1000) * highScorePrizes.length)];
          selectedPrize = pick.prize;
        }
      }

      // Se não há prêmio real elegível, usa filler
      if (!selectedPrize) {
        if (fillerPrizes.length > 0) {
          const fi = Math.floor((entropyFactor / 1000) * fillerPrizes.length);
          selectedPrize = fillerPrizes[fi];
        } else {
          selectedPrize = allPrizes[0]; // fallback
        }
      }

      // 6. Calcula o índice do segmento na roleta para o frontend animar
      const segmentIndex = allPrizes.findIndex(p => p.id === selectedPrize!.id);

      // 7. Gera código de resgate se necessário
      let redemptionCode = null;
      if (selectedPrize.generate_code && selectedPrize.is_prize && !selectedPrize.is_filler) {
        const { data: codeData } = await db.rpc("generate_redemption_code");
        redemptionCode = codeData;
      }

      // 8. Registra o spin no banco
      await db.from("spins").insert({
        session_id: session.id,
        phone, campaign_id,
        prize_id: selectedPrize.id,
        segment_index: segmentIndex,
        segment_label: selectedPrize.label,
        is_prize: selectedPrize.is_prize && !selectedPrize.is_filler,
        redemption_code: redemptionCode,
        distribution_score: 0,
        eligible_prizes: JSON.stringify(eligiblePrizes.map(p => p.id)),
      });

      // 9. Atualiza session e participant
      const nextAllowed = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      await db.from("sessions").update({ status: "played", spin_at: now.toISOString() }).eq("id", session.id);
      await db.from("participants").upsert({
        phone, campaign_id,
        last_played_at: now.toISOString(),
        next_allowed_at: nextAllowed,
        total_plays: (participant?.total_plays || 0) + 1,
      }, { onConflict: "phone,campaign_id" });

      // 10. Atualiza estoque e contadores do prêmio
      const updatePrize: Record<string, unknown> = {
        last_awarded_at: now.toISOString(),
        total_awarded: (selectedPrize.total_awarded || 0) + 1,
        today_date: today,
        today_awarded: ((selectedPrize.today_date === today ? selectedPrize.today_awarded : 0) || 0) + 1,
      };
      if (selectedPrize.stock_total > 0) {
        updatePrize.stock_remaining = Math.max(0, (selectedPrize.stock_remaining || 0) - 1);
      }
      await db.from("prizes").update(updatePrize).eq("id", selectedPrize.id);

      return ok({
        segment_index: segmentIndex,
        prize_name: selectedPrize.label,
        description: selectedPrize.description,
        instruction: selectedPrize.instruction,
        icon: selectedPrize.icon,
        is_prize: selectedPrize.is_prize && !selectedPrize.is_filler,
        redemption_code: redemptionCode,
        next_allowed_at: nextAllowed,
      });
    }

    // ============================================================
    // ROTA: POST /webhook/whatsapp — Recebe eventos do motor WA
    // ============================================================
    if (req.method === "POST" && path === "/webhook/whatsapp") {
      const payload = await req.json();
      // Adapte conforme seu motor (Evolution API, Z-API, WPPConnect)
      const event = parseWhatsAppEvent(payload);
      if (event) {
        await db.from("whatsapp_events").insert({
          event_type: event.type,
          phone: event.phone,
          group_id: event.groupId,
          raw_payload: payload,
        });
      }
      return ok({ received: true });
    }

    // ============================================================
    // ROTAS ADMIN — Requerem x-admin-token válido
    // ============================================================
    const adminToken = req.headers.get("x-admin-token") || "";
    if (!await verifyAdminToken(db, adminToken) && path.startsWith("/admin")) {
      return err("Não autorizado", 401);
    }

    // GET /admin/stats
    if (req.method === "GET" && path === "/admin/stats") {
      const [total, today, prizes, active] = await Promise.all([
        db.from("spins").select("id", { count: "exact" }),
        db.from("spins").select("id", { count: "exact" }).gte("created_at", new Date().toISOString().split("T")[0]),
        db.from("spins").select("id", { count: "exact" }).eq("is_prize", true),
        db.from("campaigns").select("id", { count: "exact" }).eq("active", true),
      ]);
      const { data: recent } = await db.from("spins")
        .select("*, campaigns(name)")
        .order("created_at", { ascending: false }).limit(20);
      return ok({
        total_spins: total.count, today_spins: today.count,
        prizes_given: prizes.count, active_campaigns: active.count,
        recent: (recent || []).map((s: Record<string, unknown>) => ({
          ...s, campaign_name: (s.campaigns as Record<string, string>)?.name
        })),
      });
    }

    // CRUD Campanhas
    if (req.method === "GET" && path === "/admin/campaigns") {
      const { data } = await db.from("campaigns").select("*").order("created_at", { ascending: false });
      return ok(data || []);
    }
    if (req.method === "POST" && path === "/admin/campaigns") {
      const body = await req.json();
      const { data } = await db.from("campaigns").insert(body).select().single();
      return ok(data, 201);
    }
    if (req.method === "GET" && path.match(/^\/admin\/campaigns\/[\w-]+$/)) {
      const id = path.split("/")[3];
      const { data } = await db.from("campaigns").select("*").eq("id", id).single();
      return ok(data);
    }
    if (req.method === "PUT" && path.match(/^\/admin\/campaigns\/[\w-]+$/)) {
      const id = path.split("/")[3];
      const body = await req.json();
      const { data } = await db.from("campaigns").update(body).eq("id", id).select().single();
      return ok(data);
    }

    // CRUD Prêmios
    if (req.method === "GET" && path.match(/^\/admin\/campaigns\/[\w-]+\/prizes$/)) {
      const id = path.split("/")[3];
      const { data } = await db.from("prizes").select("*").eq("campaign_id", id).order("weight", { ascending: false });
      return ok(data || []);
    }
    if (req.method === "POST" && path === "/admin/prizes") {
      const body = await req.json();
      if (body.stock_total > 0) body.stock_remaining = body.stock_total;
      const { data } = await db.from("prizes").insert(body).select().single();
      return ok(data, 201);
    }
    if (req.method === "GET" && path.match(/^\/admin\/prizes\/[\w-]+$/)) {
      const id = path.split("/")[3];
      const { data } = await db.from("prizes").select("*").eq("id", id).single();
      return ok(data);
    }
    if (req.method === "PUT" && path.match(/^\/admin\/prizes\/[\w-]+$/)) {
      const id = path.split("/")[3];
      const body = await req.json();
      const { data } = await db.from("prizes").update(body).eq("id", id).select().single();
      return ok(data);
    }
    if (req.method === "DELETE" && path.match(/^\/admin\/prizes\/[\w-]+$/)) {
      const id = path.split("/")[3];
      await db.from("prizes").delete().eq("id", id);
      return ok({ deleted: true });
    }

    // Relatórios
    if (req.method === "GET" && path === "/admin/reports") {
      const cId = url.searchParams.get("campaign_id") || "";
      const dFrom = url.searchParams.get("date_from") || "";
      const dTo = url.searchParams.get("date_to") || "";
      let q = db.from("spins").select("*, campaigns(name)").order("created_at", { ascending: false }).limit(500);
      if (cId) q = q.eq("campaign_id", cId);
      if (dFrom) q = q.gte("created_at", dFrom);
      if (dTo) q = q.lte("created_at", dTo + "T23:59:59");
      const { data } = await q;
      const rows = (data || []).map((s: Record<string, unknown>) => ({
        ...s, campaign_name: (s.campaigns as Record<string, string>)?.name
      }));
      const total = rows.length;
      const prizes = rows.filter((r: Record<string, unknown>) => r.is_prize).length;
      const redeemed = rows.filter((r: Record<string, unknown>) => r.redeemed).length;
      const uniquePhones = new Set(rows.map((r: Record<string, unknown>) => r.phone)).size;
      return ok({ participations: rows, summary: { total, prizes, redeemed, unique_phones: uniquePhones } });
    }

    // Resgatar código
    if (req.method === "POST" && path === "/admin/redeem") {
      const { code } = await req.json();
      const { data: spin } = await db.from("spins").select("*").eq("redemption_code", code.toUpperCase()).single();
      if (!spin) return ok({ success: false });
      if (spin.redeemed) return ok({ success: false, message: "Já resgatado" });
      await db.from("spins").update({ redeemed: true, redeemed_at: new Date().toISOString() }).eq("id", spin.id);
      return ok({ success: true, prize_name: spin.segment_label, phone: spin.phone });
    }

    // Auth admin
    if (req.method === "POST" && path === "/admin/auth") {
      const { password } = await req.json();
      const { data: setting } = await db.from("admin_settings").select("value").eq("key", "admin_password_hash").single();
      const { data: valid } = await db.rpc("check_password", { pwd: password, hsh: setting?.value });
      if (!valid) return err("Senha incorreta", 401);
      const token = crypto.randomUUID();
      const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      await db.from("admin_settings").upsert({ key: "admin_token", value: token + "|" + expires });
      return ok({ token });
    }

    return err("Rota não encontrada", 404);
  } catch (e) {
    console.error("API Error:", e);
    return err("Erro interno do servidor", 500);
  }
});

// ============================================================
// HELPERS
// ============================================================
async function verifyAdminToken(db: ReturnType<typeof createClient>, token: string): Promise<boolean> {
  if (!token) return false;
  const { data } = await db.from("admin_settings").select("value").eq("key", "admin_token").single();
  if (!data?.value) return false;
  const [storedToken, expires] = data.value.split("|");
  if (storedToken !== token) return false;
  if (expires && new Date(expires) < new Date()) return false;
  return true;
}

function parseWhatsAppEvent(payload: Record<string, unknown>) {
  // Adaptação genérica — ajuste conforme seu motor WA
  // Evolution API format
  if (payload.event === "group-participants.update") {
    const update = payload.data as Record<string, unknown>;
    if (update?.action === "add") {
      const participants = update?.participants as string[];
      const groupId = (update?.id as string)?.split("@")[0];
      return { type: "group_join", phone: participants?.[0]?.replace("@s.whatsapp.net", ""), groupId };
    }
  }
  // Z-API format
  if (payload.type === "ReceivedCallback" && payload.isGroup) {
    return { type: "message", phone: (payload.phone as string)?.replace("@c.us", ""), groupId: (payload.chatId as string)?.replace("@g.us","") };
  }
  // WPPConnect format
  if (payload.event === "onAddedToGroup" || payload.event === "onParticipantsChanged") {
    return { type: "group_join", phone: (payload.phone as string) || "", groupId: (payload.groupId as string) || "" };
  }
  return null;
}
