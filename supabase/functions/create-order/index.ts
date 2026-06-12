import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────
// create-order  (v2: 서버 완전 재계산)
//   브라우저가 보낸 금액도, 장바구니의 _line_price 도 절대 신뢰하지 않는다.
//   selected_options 안의 선택 식별자(po_id / item_index / _addon)를 기준으로
//   product_purchase_options 를 다시 조회해서 옵션가를 서버가 재계산한다.
//   ※ 포인트 차감 / 쿠폰 사용처리는 이 단계에서 하지 않는다 (pending + 예정 기록만).
//      실제 차감은 toss-confirm(paid) 에서 수행.
//   ※ service_role 키는 이 함수(서버) 안에서만 사용.
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

function mainImg(p: any): string | null {
  const pm = p?.product_media;
  if (pm && pm.length) {
    const m = pm.filter((x: any) => x.role === "main")
               .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0));
    return m.length ? m[0].media_url : pm[0].media_url;
  }
  return p?.image_url ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "허용되지 않은 메서드입니다" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error("[create-order] 환경변수 누락",
        [!SUPABASE_URL && "SUPABASE_URL", !SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean));
      return json({ success: false, message: "서버 설정 오류" }, 500);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    /* ── 1. 인증: 토큰으로 본인 확인 (로그아웃이면 거부) ── */
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ success: false, message: "로그인이 필요합니다" }, 401);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ success: false, message: "로그인이 필요합니다" }, 401);

    /* ── 2. 입력 파싱 (금액은 받지 않는다) ── */
    let body: any;
    try { body = await req.json(); } catch { return json({ success: false, message: "잘못된 요청입니다" }, 400); }
    const cartItemIds: string[] = Array.isArray(body.cartItemIds) ? body.cartItemIds : [];
    const recipient = body.recipient || {};
    const userCouponId = body.userCouponId || null;       // ★ 보유 쿠폰 단위 식별자 (우선)
    const couponId = body.couponId || null;               // 하위호환 (userCouponId 없을 때만 사용)
    let pointsToUse = Math.max(0, Math.floor(Number(body.pointsToUse) || 0));

    if (!cartItemIds.length) return json({ success: false, message: "주문할 상품이 없습니다" }, 400);
    if (!recipient.name || !recipient.phone || !recipient.address1)
      return json({ success: false, message: "배송 정보를 입력해주세요" }, 400);

    /* ── 3. 장바구니: 반드시 "본인 카트"의 아이템만 ── */
    const { data: cart } = await supabase.from("carts").select("id").eq("user_id", user.id).single();
    if (!cart) return json({ success: false, message: "장바구니를 찾을 수 없습니다" }, 400);
    const { data: items } = await supabase
      .from("cart_items")
      .select("*, products(*, product_media(media_url, role, display_order))")
      .in("id", cartItemIds)
      .eq("cart_id", cart.id);
    if (!items || items.length !== cartItemIds.length)
      return json({ success: false, message: "주문 상품 정보가 올바르지 않습니다" }, 400);

    /* ── 3.5 선택된 구매옵션(po) 일괄 조회 → poMap ── */
    const poIdSet = new Set<string>();
    for (const it of items) {
      const so: any = it.selected_options || {};
      if (Array.isArray(so._sel)) so._sel.forEach((s: any) => { if (s?.po_id) poIdSet.add(s.po_id); });
      if (so._addon && so.po_id) poIdSet.add(so.po_id);
    }
    const poMap: Record<string, any> = {};
    if (poIdSet.size) {
      const { data: pos } = await supabase
        .from("product_purchase_options")
        .select("id, product_id, option_title, price, items")
        .in("id", [...poIdSet]);
      (pos || []).forEach((p: any) => { poMap[p.id] = p; });
    }

    /* ── 3.6 각 상품에 구매옵션(product_purchase_options)이 존재하는지 미리 조회 ──
       구매옵션이 있는 상품은 반드시 _sel(또는 _addon)을 가져야만 결제 가능.       */
    const prodIds = [...new Set(items.map((it: any) => it.products?.id).filter(Boolean))];
    const { data: poExistRows } = await supabase
      .from("product_purchase_options")
      .select("product_id")
      .in("product_id", prodIds as string[]);
    const hasPurchaseOpt = new Set<string>((poExistRows || []).map((r: any) => r.product_id));

    /* ── 4. 소계 + option_snapshot 을 "서버가" 재계산/재생성 ──
       _line_price 는 절대 사용하지 않는다.                       */
    let subtotal = 0, discount = 0;
    const lineCalc: Array<{ unit: number; snap: Record<string, unknown> }> = [];

    for (const it of items) {
      const p = it.products;
      if (!p) return json({ success: false, message: "상품 정보를 찾을 수 없습니다" }, 400);
      // 판매 중지/비활성 상품 거부
      if (p.is_active === false)
        return json({ success: false, message: `현재 판매하지 않는 상품이 포함되어 있습니다 (${p.name})` }, 409);

      const qty = Math.max(1, Math.floor(it.quantity || 1));
      const so: any = it.selected_options || {};

      let unit = 0;
      const snap: Record<string, unknown> = {};
      const snapParts: string[] = [];

      // (a) 단순 옵션(색상 등): products.options 에 등록된 옵션명만 허용 + 값 검증
      //     po_id / item_index 는 연결상품 줄의 내부 식별자이므로 예약키로 제외
      const RESERVED = new Set(["구성", "po_id", "item_index"]);
      const popts: any[] = Array.isArray(p.options) ? p.options : [];
      for (const k of Object.keys(so)) {
        if (k.startsWith("_") || RESERVED.has(k)) continue;
        const od = popts.find((o: any) => o.name === k);
        if (!od) // products.options 에 없는 임의 키 주입 → 거부
          return json({ success: false, message: "선택한 옵션 정보가 올바르지 않습니다." }, 400);
        if (Array.isArray(od.values) && !od.values.includes(so[k]))
          return json({ success: false, message: "선택한 옵션 정보가 올바르지 않습니다." }, 400);
        snap[k] = so[k]; // 검증된 단순 옵션만 스냅샷에 보존
      }

      if (so._addon) {
        /* (b) 연결상품 줄: 메인상품 옵션의 item.price 로 서버 재계산 */
        // 형식 검증: po_id(문자열) + item_index(0 이상 정수)
        if (typeof so.po_id !== "string" || !Number.isInteger(so.item_index) || so.item_index < 0)
          return json({ success: false, message: "연결상품 주문 정보가 올바르지 않습니다. 장바구니를 다시 담아주세요." }, 409);
        const po = poMap[so.po_id];
        if (!po) return json({ success: false, message: "장바구니를 다시 담아주세요 (옵션 정보 변경됨)" }, 409);
        const item = Array.isArray(po.items) ? po.items[so.item_index] : null;
        if (!item) return json({ success: false, message: "장바구니를 다시 담아주세요 (옵션 항목 없음)" }, 409);
        if (item.link_product_id !== p.id)
          return json({ success: false, message: "옵션 연결 정보가 올바르지 않습니다" }, 400);
        // 연결상품은 단독 주문 불가: 같은 주문 안에 같은 po_id+item_index 를 _sel 로 가진
        // "부모 메인 줄"이 반드시 있어야 한다 (메인 없이 연결상품만 특가 구매 차단)
        const parent = items.find((o: any) => {
          const oso: any = o.selected_options || {};
          return !oso._addon && Array.isArray(oso._sel)
            && oso._sel.some((s: any) => s.po_id === so.po_id && s.item_index === so.item_index);
        });
        if (!parent || po.product_id !== parent.products?.id)
          return json({ success: false, message: "연결상품 주문 정보가 올바르지 않습니다. 장바구니를 다시 담아주세요." }, 409);
        unit = Number(item.price) || 0;
        snapParts.push(item.color_name || item.name || "");

      } else if (Array.isArray(so._sel)) {
        /* (c) 메인 구매옵션 줄: po_id/item_index 로 완전 재계산 */
        // 빈 _sel 차단 (구매옵션 상품인데 아무것도 안 골라 0원 되는 조작 방지)
        if (so._sel.length === 0)
          return json({ success: false, message: "장바구니를 다시 담아주세요. 선택한 옵션 정보가 올바르지 않습니다." }, 409);
        // 각 항목 형식 검증: po_id(문자열) + item_index(0 이상 정수)
        for (const s of so._sel) {
          if (!s || typeof s.po_id !== "string" || !Number.isInteger(s.item_index) || s.item_index < 0)
            return json({ success: false, message: "장바구니를 다시 담아주세요. 선택한 옵션 정보가 올바르지 않습니다." }, 409);
        }
        const poIds = [...new Set(so._sel.map((s: any) => s.po_id))];
        for (const pid of poIds) {
          const po = poMap[pid as string];
          // 옵션이 실제 존재하고, 이 상품 소속인지 검증 (아니면 거부)
          if (!po || po.product_id !== p.id)
            return json({ success: false, message: "선택한 옵션이 이 상품에 속하지 않습니다" }, 400);
          unit += Number(po.price) || 0; // 옵션 기본가 (옵션당 1회)
        }
        for (const s of so._sel) {
          const po = poMap[s.po_id];
          const item = (po && Array.isArray(po.items)) ? po.items[s.item_index] : null;
          if (!item) return json({ success: false, message: "장바구니를 다시 담아주세요 (옵션 항목 없음)" }, 409);
          if (item.link_product_id && item.link_product_id !== p.id) {
            // 연결상품 → 가격은 별도 _addon 줄에서 계산된다.
            // 그 _addon 줄이 실제로 존재하고 수량까지 일치하는지 검증 (addon 줄 삭제/수량 조작 차단)
            const addonLine = items.find((o: any) => {
              const oso: any = o.selected_options || {};
              return oso._addon === true && oso.po_id === s.po_id && oso.item_index === s.item_index
                && o.products?.id === item.link_product_id;
            });
            if (!addonLine || Math.max(1, Math.floor(addonLine.quantity || 1)) !== qty)
              return json({ success: false, message: "연결상품 주문 정보가 누락되었습니다. 장바구니를 다시 담아주세요." }, 409);
            continue;
          }
          unit += Number(item.price) || 0;
          const nm = item.color_name || item.name || "";
          const pr = Number(item.price) || 0;
          snapParts.push(pr > 0 ? `${nm} (+${pr.toLocaleString()}원)` : nm);
        }

      } else if (so._line_price !== undefined) {
        /* (d) 레거시 장바구니(선택 식별자 없음) → 거부 */
        return json({ success: false, message: "장바구니를 다시 담아주세요. 상품 옵션 정보가 업데이트되었습니다." }, 409);

      } else {
        /* (e) 구매옵션이 있는 상품인데 _sel/_addon 둘 다 없음 → 조작 의심, 거부 */
        if (hasPurchaseOpt.has(p.id))
          return json({ success: false, message: "장바구니를 다시 담아주세요. 상품 옵션 정보가 필요합니다." }, 409);
        /* 구매옵션 없는 일반 상품: products.options 에 등록된 옵션은 모두 선택돼 있어야 함 (배송 누락 방지)
           값 유효성은 위 (a) 에서 검증됨 — 여기선 "누락"만 차단 */
        for (const od of popts) {
          if (!od || !od.name || !Array.isArray(od.values) || od.values.length === 0) continue;
          const v = so[od.name];
          if (v === undefined || v === null || v === "")
            return json({ success: false, message: "상품 옵션을 다시 선택해주세요." }, 400);
        }
        /* 단순 상품 → 상품 기본가 */
        unit = Number(p.price) || 0;
      }

      if (snapParts.length) snap["구성"] = snapParts.join(", ");

      subtotal += unit * qty;
      if (p.original_price && p.original_price > p.price) discount += (p.original_price - p.price) * qty;
      lineCalc.push({ unit, snap });
    }

    /* ── 5. 배송비 (site_settings) ── */
    const { data: settings } = await supabase.from("site_settings").select("key, value");
    let SHIPPING_FEE = 3000, FREE_SHIPPING = 50000;
    (settings || []).forEach((r: any) => {
      if (r.key === "shipping_fee") SHIPPING_FEE = parseInt(r.value) || 3000;
      if (r.key === "free_shipping_amount") FREE_SHIPPING = parseInt(r.value) || 50000;
    });
    const shipping = subtotal >= FREE_SHIPPING ? 0 : (subtotal > 0 ? SHIPPING_FEE : 0);

    /* ── 6. 쿠폰: user_coupon_id(보유쿠폰) 기준 · 본인소유 + 미사용 + 활성/만료/한도/최소금액 검증, 할인 서버 재계산 ── */
    let couponDiscount = 0, validCouponId: string | null = null, validUserCouponId: string | null = null;
    if (userCouponId || couponId) {
      let q = supabase
        .from("user_coupons")
        .select("*, coupons(*)")
        .eq("user_id", user.id)        // ★ 반드시 본인 소유만 (남의 쿠폰 차단)
        .eq("is_used", false);
      if (userCouponId) q = q.eq("id", userCouponId);   // 보유 쿠폰 식별자 우선
      else q = q.eq("coupon_id", couponId);             // 하위호환
      const { data: uc } = await q.limit(1).maybeSingle();
      if (!uc || !uc.coupons) return json({ success: false, message: "사용할 수 없는 쿠폰입니다" }, 400);
      const c: any = uc.coupons;
      if (c.is_active === false)
        return json({ success: false, message: "사용할 수 없는 쿠폰입니다 (비활성)" }, 400);
      // 만료: 보유쿠폰 expires_at 우선, 없으면 쿠폰 마스터 valid_until
      const expMs = uc.expires_at ? new Date(uc.expires_at).getTime()
                  : (c.valid_until ? new Date(c.valid_until).getTime() : null);
      if (expMs !== null && expMs < Date.now())
        return json({ success: false, message: "쿠폰 유효기간이 지났습니다" }, 400);
      if (c.usage_limit && Number(c.used_count || 0) >= Number(c.usage_limit))
        return json({ success: false, message: "쿠폰 사용 한도가 초과되었습니다" }, 400);
      if (c.min_order_amount && subtotal < c.min_order_amount)
        return json({ success: false, message: "쿠폰 최소 주문금액을 채우지 못했습니다" }, 400);
      if (c.discount_type === "percent") {
        couponDiscount = Math.floor(subtotal * c.discount_value / 100);
        if (c.max_discount && couponDiscount > c.max_discount) couponDiscount = c.max_discount;
      } else {
        couponDiscount = c.discount_value;
      }
      if (couponDiscount > subtotal) couponDiscount = subtotal;
      validCouponId = uc.coupon_id;
      validUserCouponId = uc.id;
      // ※ 여기서는 절대 사용처리하지 않는다 (is_used 그대로). 실제 사용처리는 toss-confirm(paid)에서.
    }

    /* ── 7. 포인트: user_profiles.point 잔액·한도 검증 ── */
    const { data: prof } = await supabase.from("user_profiles").select("point").eq("id", user.id).single();
    const ownedPoints = Math.max(0, Math.floor(prof?.point || 0));
    if (pointsToUse > ownedPoints) return json({ success: false, message: "보유 포인트를 초과했습니다" }, 400);
    const afterCoupon = Math.max(0, subtotal - couponDiscount);
    if (pointsToUse > afterCoupon) pointsToUse = afterCoupon; // 결제액 초과 사용 방지

    /* ── 8. 최종 금액 (서버 확정값) ── */
    const total = Math.max(0, subtotal + shipping - couponDiscount - pointsToUse);
    // 0원은 Toss 결제창을 띄울 수 없다 → 거부 (전액 포인트/쿠폰 결제는 별도 흐름에서 처리 예정)
    if (total <= 0)
      return json({ success: false, message: "결제 금액이 0원입니다. 포인트·쿠폰 사용 금액을 조정해주세요." }, 400);

    /* ── 9. orders insert (pending) — 주문번호 충돌 시 재시도 ── */
    const now = new Date();
    const dateStr = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, "0")
      + String(now.getDate()).padStart(2, "0");

    const orderPayload: Record<string, unknown> = {
      user_id: user.id,
      status: "pending",
      recipient_name: recipient.name,
      phone: recipient.phone,
      zipcode: recipient.zipcode || null,
      address1: recipient.address1,
      address2: recipient.address2 || null,
      delivery_memo: recipient.memo || null,
      subtotal,
      shipping_fee: shipping,
      discount_amount: discount,
      total_amount: total,
      coupon_id: validCouponId,
      coupon_discount: couponDiscount,
      user_coupon_id: validUserCouponId,
      points_used: pointsToUse,
    };

    let order: any = null, lastErr: any = null, orderNumber = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      orderNumber = "YT-" + dateStr + "-" + String(Math.floor(Math.random() * 100000)).padStart(5, "0");
      const r = await supabase.from("orders").insert({ ...orderPayload, order_number: orderNumber }).select().single();
      if (!r.error && r.data) { order = r.data; break; }
      lastErr = r.error;
      if (r.error && r.error.code === "23505") continue; // 주문번호 중복 → 재시도
      break; // 다른 에러는 즉시 중단
    }
    if (!order) {
      console.error("[create-order] orders insert 실패", lastErr);
      return json({ success: false, message: "주문 생성에 실패했습니다" }, 500);
    }

    /* ── 10. order_items insert — option_snapshot/item_total 은 서버 재계산값만 ── */
    const orderItems = items.map((it: any, idx: number) => {
      const p = it.products;
      const qty = Math.max(1, Math.floor(it.quantity || 1));
      const calc = lineCalc[idx];
      return {
        order_id: order.id,
        product_id: p.id,
        product_name_snapshot: p.name,
        product_brand_snapshot: p.brand || "YLLOWTAP",
        product_image_snapshot: mainImg(p),
        product_price_snapshot: p.price,
        product_original_price_snapshot: p.original_price || null,
        option_snapshot: calc.snap,        // 서버가 DB 기준으로 재생성한 값
        quantity: qty,
        item_total: calc.unit * qty,       // 서버 재계산 단가 × 수량
      };
    });
    const { error: itemsErr } = await supabase.from("order_items").insert(orderItems);
    if (itemsErr) {
      console.error("[create-order] order_items insert 실패", itemsErr);
      await supabase.from("orders").delete().eq("id", order.id); // 고아 주문 롤백
      return json({ success: false, message: "주문 항목 생성에 실패했습니다" }, 500);
    }

    /* ── 11. 응답: 서버 확정 금액 + 주문번호 ── */
    const firstName = items[0]?.products?.name || "상품";
    const orderName = items.length > 1 ? firstName + " 외 " + (items.length - 1) + "건" : firstName;

    return json({
      success: true,
      orderId: orderNumber, // toss-confirm 이 order_number 로 조회
      amount: total,        // 서버 확정 금액 (Toss 결제창 금액)
      orderName,
      couponId: validCouponId,
      userCouponId: validUserCouponId,
      pointsUsed: pointsToUse,
    });
  } catch (e) {
    console.error("[create-order] 예외", e);
    return json({ success: false, message: "주문 처리 중 오류가 발생했습니다" }, 500);
  }
});