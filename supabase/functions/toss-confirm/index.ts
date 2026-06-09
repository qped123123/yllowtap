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

// [보강2] 결제 동기화 실패를 DB(payment_sync_failures)에 기록.
//   - Supabase insert는 실패해도 예외를 안 던지고 { error }로 반환하므로 반드시 error를 확인.
//   - 기록 저장 자체가 실패해도(예외 포함) 고객 결제 흐름은 막지 않되, 강하게 로그를 남긴다.
async function logSyncFailure(
  supabase: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) {
  try {
    const { error } = await supabase.from("payment_sync_failures").insert(row);
    if (error) {
      console.error("★[STEP2] 실패기록 저장 실패(insert error) — 사고 추적 불가 위험 ★", error);
    }
  } catch (e) {
    console.error("★[STEP2] 실패기록 저장 중 예외 ★", e);
  }
}

Deno.serve(async (req) => {
  /* ── CORS preflight ── */
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // [보강6] OPTIONS 외에는 POST 만 허용
  if (req.method !== "POST") {
    return json({ success: false, message: "허용되지 않은 메서드입니다" }, 405);
  }

  try {
    // [보강5] 환경변수 확인 — 없으면 secret 값 노출 없이(이름만) 500
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const TOSS_SECRET_KEY = Deno.env.get("TOSS_SECRET_KEY");
    const missingEnv = [
      !SUPABASE_URL && "SUPABASE_URL",
      !SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
      !TOSS_SECRET_KEY && "TOSS_SECRET_KEY",
    ].filter(Boolean);
    if (missingEnv.length > 0) {
      console.error("[STEP2] 환경변수 누락(이름만):", missingEnv);
      return json({ success: false, message: "서버 설정 오류" }, 500);
    }

    /* ── 1. 요청 파싱 ([보강6] 파싱 실패는 400) ── */
    let body: { paymentKey?: unknown; orderId?: unknown; amount?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ success: false, message: "잘못된 요청 형식입니다" }, 400);
    }
    let { paymentKey, orderId, amount } = body as {
      paymentKey?: unknown; orderId?: unknown; amount?: unknown;
    };

    // [보강4] paymentKey, orderId 는 문자열 + trim 후 빈 문자열이 아님
    if (
      typeof paymentKey !== "string" || paymentKey.trim() === "" ||
      typeof orderId !== "string" || orderId.trim() === ""
    ) {
      return json(
        { success: false, message: "필수 파라미터 형식 오류 (paymentKey, orderId)" },
        400
      );
    }
    paymentKey = paymentKey.trim();
    orderId = orderId.trim();

    // [보강1·3] amount 를 Number 변환 후 검증 (유한수 & 0 초과 & 정수)
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0 || !Number.isInteger(numAmount)) {
      console.error("[STEP2] 유효하지 않은 amount:", { orderId, amount });
      return json({ success: false, message: "유효하지 않은 결제 금액입니다" }, 400);
    }

    /* ── service_role 클라이언트 (RLS 무관, 서버 전용) ── */
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    /* ============================================================
       ★ STEP 2 핵심 : 토스 승인 "전에" 주문을 DB에서 검증
       ============================================================ */

    // [조건1] order_number 로 주문 조회 ([보강2] payment_key 컬럼 포함)
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, order_number, status, total_amount, payment_key, payment_method, paid_at")
      .eq("order_number", orderId)
      .maybeSingle();

    // [보강5] DB 조회 에러(500) 와 주문 없음(404) 을 구분
    if (orderErr) {
      console.error("[STEP2] 주문 조회 DB 에러:", { orderId, orderErr });
      return json({ success: false, message: "주문 조회 중 오류가 발생했습니다" }, 500);
    }
    if (!order) {
      console.error("[STEP2] 주문 없음:", { orderId });
      return json({ success: false, message: "주문을 찾을 수 없습니다" }, 404);
    }

    // [보강1] 이미 paid:
    //   - 기존 payment_key == 요청 paymentKey → 멱등 success
    //   - 그 외 → 중복/의심으로 409
    if (order.status === "paid") {
      if (order.payment_key && order.payment_key === paymentKey) {
        console.warn("[STEP2] 동일 paymentKey 재요청 — 멱등 처리:", orderId);
        return json({
          success: true,
          alreadyPaid: true,
          totalAmount: order.total_amount,
          method: order.payment_method,
          approvedAt: order.paid_at,
          message: "이미 처리된 결제입니다",
        });
      }
      console.error("[STEP2] 이미 paid 주문에 다른 paymentKey — 중복/의심 차단:", {
        orderId,
        existing: order.payment_key,
        incoming: paymentKey,
      });
      return json({ success: false, message: "이미 처리된 주문입니다" }, 409);
    }

    // [보강1] pending 이 아닌 모든 상태(cancelled/refunded/기타)는 Toss 승인 전 거부
    if (order.status !== "pending") {
      console.error("[STEP2] 결제 불가 상태 — Toss 승인 전 거부:", {
        orderId,
        status: order.status,
      });
      return json({ success: false, message: "결제할 수 없는 주문 상태입니다" }, 409);
    }

    // [조건4] ★ 금액 대조 : 요청 amount === DB total_amount
    if (Number(order.total_amount) !== numAmount) {
      console.error("[STEP2] 금액 불일치(조작 의심) — 승인 거부:", {
        orderId,
        requestAmount: numAmount,
        dbAmount: order.total_amount,
      });
      return json({ success: false, message: "결제 금액이 일치하지 않습니다" }, 400);
    }

    /* ── 2. Toss 결제 승인 API 호출 (검증 통과 후에만) ── */
    const tossAuth = btoa(TOSS_SECRET_KEY + ":");

    const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: "Basic " + tossAuth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount: numAmount }),
    });

    const tossData = await tossRes.json();

    if (!tossRes.ok) {
      console.error("[STEP2] Toss 승인 실패:", tossData);
      return json(
        {
          success: false,
          code: tossData.code || "UNKNOWN",
          message: tossData.message || "결제 승인에 실패했습니다",
        },
        400
      );
    }

    // [보강1] Toss 응답값을 요청값/DB값과 재검증 (paymentKey·orderId·금액·완료상태)
    const tossVerified =
      tossData.paymentKey === paymentKey &&
      tossData.orderId === orderId &&
      Number(tossData.totalAmount) === numAmount &&
      tossData.status === "DONE";
    if (!tossVerified) {
      console.error("★[STEP2] Toss 응답 불일치 — 동기화 실패 기록 ★", {
        orderId,
        expected: { paymentKey, orderId, totalAmount: numAmount, status: "DONE" },
        got: {
          paymentKey: tossData.paymentKey,
          orderId: tossData.orderId,
          totalAmount: tossData.totalAmount,
          status: tossData.status,
        },
      });
      await logSyncFailure(supabase, {
        order_number: orderId,
        order_id: order.id,
        payment_key: tossData.paymentKey ?? paymentKey,
        amount: numAmount,
        toss_payment_key: tossData.paymentKey,
        reason: "toss_response_mismatch",
        detail: {
          paymentKey: tossData.paymentKey,
          orderId: tossData.orderId,
          totalAmount: tossData.totalAmount,
          status: tossData.status,
          method: tossData.method,
          approvedAt: tossData.approvedAt,
        },
      });
      return json(
        { success: false, message: "결제 검증에 실패했습니다. 고객센터로 문의해주세요." },
        409
      );
    }

    /* ── 3. DB 업데이트: orders.status → paid ([조건6]) ── */
    const updatePayload = {
      status: "paid",
      payment_key: tossData.paymentKey,
      payment_method: tossData.method,
      paid_at: tossData.approvedAt || new Date().toISOString(),
    };

    // [보강2,3] order.id 기준 + status=pending 으로 업데이트, .select 로 반영 행 확인
    const runUpdate = () =>
      supabase
        .from("orders")
        .update(updatePayload)
        .eq("id", order.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

    // [조건7] 1차 → 실패(에러) 또는 0행이면 재시도 1회
    let { data: updatedOrder, error: updateErr } = await runUpdate();
    if (updateErr || !updatedOrder) {
      console.error("[STEP2] DB 업데이트 1차 실패/0행 → 재시도:", { updateErr });
      ({ data: updatedOrder, error: updateErr } = await runUpdate());
    }

    // [보강3] 에러는 없는데 0행이면 — 이미 처리됐을 수 있으니 재조회로 멱등 확인
    if (!updateErr && !updatedOrder) {
      const { data: recheck } = await supabase
        .from("orders")
        .select("status, payment_key, total_amount, payment_method, paid_at")
        .eq("id", order.id)
        .maybeSingle();
      if (
        recheck &&
        recheck.status === "paid" &&
        recheck.payment_key === tossData.paymentKey
      ) {
        console.warn("[STEP2] 재조회 결과 이미 paid(동일 key) — 멱등 성공:", orderId);
        return json({
          success: true,
          totalAmount: recheck.total_amount,
          method: recheck.payment_method,
          approvedAt: recheck.paid_at,
        });
      }
    }

    // [보강2] 최종 실패(에러 또는 0행)면 DB에 동기화 실패 기록 저장 (+강한 로그)
    //   (돈은 이미 빠졌으므로 응답은 success 유지)
    if (updateErr || !updatedOrder) {
      console.error("★[STEP2] 결제동기화 실패 — 기록 저장 ★", {
        reason: updateErr ? "update error" : "0 rows updated",
        orderId,
        error: updateErr,
      });
      await logSyncFailure(supabase, {
        order_number: orderId,
        order_id: order.id,
        payment_key: tossData.paymentKey,
        amount: numAmount,
        toss_payment_key: tossData.paymentKey,
        reason: updateErr ? "db_update_error" : "db_update_zero_rows",
        detail: { updateErr, approvedAt: tossData.approvedAt, method: tossData.method },
      });
      // 알림/재처리 큐는 STEP 3(결제·후처리 서버화)에서 설계
    }

    /* ── 4. 성공 응답 (형식은 기존과 동일 — order-complete.html 그대로 동작) ── */
    return json({
      success: true,
      totalAmount: tossData.totalAmount,
      method: tossData.method,
      approvedAt: tossData.approvedAt,
    });
  } catch (e) {
    console.error("[STEP2] Edge Function 오류:", e);
    return json({ success: false, message: "서버 내부 오류" }, 500);
  }
});