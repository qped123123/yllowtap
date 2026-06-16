import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────
// delete-account
//   회원 탈퇴 시 Auth 계정(auth.users)을 완전 삭제한다.
//   - 호출자의 JWT로 "본인"을 확인한 뒤, 그 본인 계정만 service_role로 삭제.
//     (남의 계정은 절대 삭제 불가)
//   - 개인 데이터(cart/wishlist/쿠폰/프로필 등)는 클라이언트에서 먼저 삭제한 뒤
//     이 함수를 호출하는 흐름. 여기서는 Auth 계정만 처리.
//   - orders 등 법정 보존 데이터는 건드리지 않는다.
// ─────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "허용되지 않은 메서드입니다" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      console.error("[delete-account] env 누락",
        [!SUPABASE_URL && "SUPABASE_URL", !SERVICE_ROLE && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean));
      return json({ success: false, message: "서버 설정 오류" }, 500);
    }

    // service_role 클라이언트 (create-order와 동일 패턴)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) 요청자의 JWT로 본인 확인 — 토큰을 getUser 인자로 직접 전달
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ success: false, message: "로그인이 필요합니다" }, 401);

    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) {
      console.error("[delete-account] 토큰 검증 실패", userErr);
      return json({ success: false, message: "인증에 실패했습니다" }, 401);
    }

    const uid = user.id;

    // 2) 본인 Auth 계정 삭제
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) {
      console.error("[delete-account] auth 삭제 실패", delErr);
      return json({ success: false, message: "계정 삭제에 실패했습니다: " + delErr.message }, 500);
    }

    return json({ success: true });
  } catch (e) {
    console.error("[delete-account] 오류", e);
    return json({ success: false, message: "처리 중 오류가 발생했습니다" }, 500);
  }
});