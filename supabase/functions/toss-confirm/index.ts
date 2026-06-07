import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  /* ── CORS preflight ── */
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    /* ── 1. 요청 파싱 ── */
    const { paymentKey, orderId, amount } = await req.json();
    if (!paymentKey || !orderId || !amount) {
      return json({ success: false, message: "필수 파라미터 누락 (paymentKey, orderId, amount)" }, 400);
    }

    /* ── 2. Toss 결제 승인 API 호출 ── */
    const tossSecret = Deno.env.get("TOSS_SECRET_KEY")!;
    const tossAuth = btoa(tossSecret + ":");

    const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: "Basic " + tossAuth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });

    const tossData = await tossRes.json();

    if (!tossRes.ok) {
      console.error("Toss 승인 실패:", tossData);
      return json(
        {
          success: false,
          code: tossData.code || "UNKNOWN",
          message: tossData.message || "결제 승인에 실패했습니다",
        },
        400
      );
    }

    /* ── 3. DB 업데이트: orders.status → paid ── */
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: updateErr } = await supabase
      .from("orders")
      .update({
        status: "paid",
        payment_key: tossData.paymentKey,
        payment_method: tossData.method,
        paid_at: tossData.approvedAt || new Date().toISOString(),
      })
      .eq("order_number", orderId)
      .eq("status", "pending");

    if (updateErr) {
      // Toss 승인은 이미 성공했으므로 DB 실패해도 성공 응답
      // (admin에서 수동 확인 가능, 돈이 빠진 상태에서 실패 표시하면 안 됨)
      console.error("DB 업데이트 실패 (Toss 승인은 완료):", updateErr);
    }

    /* ── 4. 성공 응답 ── */
    return json({
      success: true,
      totalAmount: tossData.totalAmount,
      method: tossData.method,
      approvedAt: tossData.approvedAt,
    });
  } catch (e) {
    console.error("Edge Function 오류:", e);
    return json({ success: false, message: "서버 내부 오류" }, 500);
  }
});
