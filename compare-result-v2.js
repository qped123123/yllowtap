/* ============================================================
   Yllowtap 취향 비교 결과화면 V2  (compare-result-v2.js)
   ------------------------------------------------------------
   하는 일
   1) URL의 products / selected + sessionStorage의 슬라이더값을 읽어요
   2) 슬라이더값으로 → 취향 타입(12개 중 1개)을 정해요
   3) 선택 상품 기준으로 → 취향 일치도 %를 계산해요
   4) 선택 기준을 자연어로 요약하고
   5) 비슷한 상품 / 어울리는 다른 카테고리 상품을 추천해요
   * 같은 입력이면 항상 같은 숫자가 나오는 고정 공식이에요(랜덤 없음).
   ============================================================ */

/* ---------- 0. 설정 (필요하면 여기만 바꾸면 돼요) ---------- */
const SUPABASE_URL  = 'https://ppihvvpplqikclftrwdb.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwaWh2dnBwbHFpa2NsZnRyd2RiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzE0NTEsImV4cCI6MjA5NTMwNzQ1MX0.shGVcFTQiuYc4u6tdU50x18YMgJdgFUljf8c7QlQU-U';   // ← Ctrl+H 로 실제 anon 키 치환

const ROUTE = {
  productDetail : (id) => `product.html?id=${id}`,        // 상품 상세 이동
  checkout      : (id) => `checkout.html?selected=${id}`, // 구매하기(기존 흐름)
  back          : 'cart.html',                            // 고르지 않고 닫기
  recommend     : (code) => `recommend.html?type=${code}` // 하단 CTA (없으면 category.html 로)
};

// 슬라이더값을 넘겨받는 sessionStorage 키 (cart.html이 여기에 저장하게 됩니다)
const SS_KEY = 'yllowtap_compare_v2';

const QKEYS = ['storage','material','durability','finish','weight'];        // 품질 0~10
const MKEYS = ['minimal','color','cute_chic','daily_special'];              // 무드 -5~+5
const QLABEL = {storage:'수납력',material:'소재',durability:'내구성',finish:'마감',weight:'무게'};

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
const $app = document.getElementById('crApp');

/* ---------- 1. 입력값 읽기 ---------- */
function readInput(){
  const url = new URLSearchParams(location.search);
  const demo = url.get('demo') === '1';

  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch(e){}

  // 슬라이더값
  let quality, mood;
  if (saved && saved.quality && saved.mood){
    quality = saved.quality; mood = saved.mood;
  } else if (demo){
    quality = {storage:8, material:8, durability:6, finish:7, weight:5};
    mood    = {minimal:-3, color:-2, cute_chic:2, daily_special:-2};
  } else {
    return null; // 비교 정보 없음
  }

  // 상품 목록 / 선택 상품 (URL 우선, 없으면 saved)
  let products = (url.get('products') || '').split(',').map(s=>s.trim()).filter(Boolean);
  if (!products.length && saved && Array.isArray(saved.products)) products = saved.products.map(String);
  let selected = url.get('selected') || (saved && saved.selected) || products[0] || null;

  const category = (saved && saved.category) || null;
  return { quality, mood, products, selected:selected?String(selected):null, category, demo };
}

/* ---------- 2. 정규화 (스케일이 달라 한쪽이 커지지 않게) ---------- */
const nQ = v => Math.max(0, Math.min(10, Number(v)||0)) / 10;        // 0~10 → 0~1
const nM = v => (Math.max(-5, Math.min(5, Number(v)||0)) + 5) / 10;  // -5~+5 → 0~1

/* 9차원 정규화 벡터 만들기 (취향타입 판정용) */
function vec9(q, m){
  return [...QKEYS.map(k=>nQ(q[k])), ...MKEYS.map(k=>nM(m[k]))];
}
function dist(a, b){
  let s=0; for(let i=0;i<a.length;i++){ const d=a[i]-b[i]; s+=d*d; } return Math.sqrt(s);
}

/* ---------- 3. 취향 타입 판정 (가장 가까운 centroid 1개) ---------- */
function pickTasteType(quality, mood, profiles){
  const me = vec9(quality, mood);
  let best=null, bestD=Infinity;
  for(const p of profiles){
    const c = p.centroid || {};
    const cq = {}, cm = {};
    QKEYS.forEach(k=>cq[k]=c[k]); MKEYS.forEach(k=>cm[k]=c[k]);
    const d = dist(me, vec9(cq, cm));
    if(d<bestD){ bestD=d; best=p; }
  }
  return best;
}

/* ---------- 4. 취향 일치도 % (선택 상품 기준) ----------
   moodScore : 무드 방향이 가까울수록 ↑
   qualityScore : 고객이 중요하다고 한 항목을 상품이 잘 채울수록 ↑ (너무 낮으면 감점)
   최종 % : 55~99 사이로 환산 → 과장된 100%나 불안한 낮은 숫자 없이 신뢰감 있게
*/
function matchPercent(quality, mood, score){
  // 무드 거리 (각 축 최대차 10, 4축 → 최대 20)
  let md=0; for(const k of MKEYS){ const d=(Number(mood[k])||0)-(Number(score[k+'_score'])||0); md+=d*d; }
  md = Math.sqrt(md);
  const moodScore = 1 - md/20;

  // 품질: 중요도 가중 충족도
  let sumW=0, sumWS=0, penalty=0;
  for(const k of QKEYS){
    const imp = Math.max(0, Math.min(10, Number(quality[k])||0));   // 중요도
    const lvl = Math.max(0, Math.min(10, Number(score[k+'_score'])||0)); // 상품 점수
    sumW  += imp;
    sumWS += imp * lvl;
    if(lvl <= 2) penalty += 0.03;   // 중요도 낮아도 상품 점수가 너무 낮으면 감점
  }
  const qFit = sumW>0 ? (sumWS/(sumW*10)) : 0.6;
  const qualityScore = Math.max(0, Math.min(1, qFit - penalty));

  const raw = 0.5*moodScore + 0.5*qualityScore;
  let pct = Math.round(55 + raw*44);
  return Math.max(55, Math.min(99, pct));
}
function matchLabel(pct){
  if(pct>=90) return '매우 잘 맞아요';
  if(pct>=80) return '잘 맞아요';
  if(pct>=70) return '꽤 맞아요';
  return '무난하게 맞아요';
}

/* ---------- 5. 선택 기준 요약 (자연어) ---------- */
function buildSummary(quality, mood){
  const lines = [];
  const qEntries = QKEYS.map(k=>({k, v:Number(quality[k])||0}));
  const high = qEntries.filter(e=>e.v>=7).sort((a,b)=>b.v-a.v);
  const allHigh = qEntries.every(e=>e.v>=7);
  const allMid  = qEntries.every(e=>Math.abs(e.v-5)<=1);

  if(allHigh){
    lines.push('전체적으로 기준이 높은 편이라, 완성도 있는 아이템을 선호하는 취향이에요.');
  } else if(allMid){
    lines.push('특정 항목에 치우치지 않고 균형 있게 보는 타입이에요.');
  } else if(high.length){
    const names = high.slice(0,3).map(e=>QLABEL[e.k]);
    lines.push(`${names.join('과 ')}을(를) 특히 중요하게 보셨어요.`);
  } else {
    lines.push('무게보다는 전체적인 균형을 보는 편이에요.');
  }

  // 무드: 방향이 강한 축 2개
  const moodPhrase = {
    minimal:       v=> v<0 ? '미니멀한' : '데코가 있는',
    color:         v=> v<0 ? '무채색의' : '컬러감 있는',
    cute_chic:     v=> v<0 ? '귀여운' : '시크한',
    daily_special: v=> v<0 ? '데일리한' : '스페셜한'
  };
  const strong = MKEYS.map(k=>({k, v:Number(mood[k])||0}))
                      .filter(e=>Math.abs(e.v)>=3)
                      .sort((a,b)=>Math.abs(b.v)-Math.abs(a.v))
                      .slice(0,2);
  if(strong.length){
    const words = strong.map(e=>moodPhrase[e.k](e.v));
    lines.push(`${words.join(', ')} 무드를 선호하는 편이에요.`);
  } else {
    lines.push('무드는 어느 한쪽으로 치우치지 않는 편안한 취향이에요.');
  }
  return lines;
}

/* ---------- 6. 상품 필드 안전하게 꺼내기 ---------- */
const pImg   = p => p.image_url || p.image || p.thumbnail || p.thumbnail_url || (Array.isArray(p.images)&&p.images[0]) || '';
const pName  = p => p.name || p.title || p.product_name || '상품';
const pPrice = p => { const n = Number(p.price ?? p.sale_price ?? 0); return n.toLocaleString('ko-KR')+'원'; };
const pCat   = p => (p.category || p.cat || '').toString();
const isBag  = c => /bag|가방/i.test(c||'');

/* ---------- 7. 데이터 로드 ---------- */
async function loadData(input){
  // 취향 타입 12개
  const { data:profiles } = await sb.from('taste_profiles')
    .select('*').eq('is_active', true).order('sort_order');

  // 비교한 상품들
  let compared = [];
  if(input.products.length){
    const { data } = await sb.from('products').select('*').in('id', input.products);
    // URL 순서 유지
    const map = {}; (data||[]).forEach(p=>map[String(p.id)]=p);
    compared = input.products.map(id=>map[id]).filter(Boolean);
  }
  // demo인데 상품이 없으면 임의로 몇 개 가져와 미리보기
  if(!compared.length && input.demo){
    const { data } = await sb.from('products').select('*').limit(3);
    compared = data || [];
    if(compared.length && !input.selected) input.selected = String(compared[0].id);
  }

  // 추천 후보(전체) + 점수
  const { data:allProducts } = await sb.from('products').select('*').limit(300);
  const { data:scoresArr }   = await sb.from('vw_product_taste_scores').select('*');
  const scoreMap = {}; (scoresArr||[]).forEach(s=>scoreMap[String(s.product_id)]=s);

  return { profiles:profiles||[], compared, allProducts:allProducts||[], scoreMap };
}

/* 점수 없는 상품 기본값 (중립) */
function scoreOf(map, id){
  return map[String(id)] || {
    storage_score:5,material_score:5,durability_score:5,finish_score:5,weight_score:5,
    minimal_score:0,color_score:0,cute_chic_score:0,daily_special_score:0
  };
}

/* ---------- 8. 렌더링 ---------- */
let STATE = {};

function render(){
  const { input, profiles, compared, allProducts, scoreMap, type, selectedId } = STATE;

  const selProduct = compared.find(p=>String(p.id)===String(selectedId)) || compared[0];
  const selScore   = scoreOf(scoreMap, selProduct?.id);
  const pct        = matchPercent(input.quality, input.mood, selScore);
  const summary    = buildSummary(input.quality, input.mood);

  // 추천 1: 비슷한 (같은 카테고리)
  const compareCat = pCat(selProduct) || (input.category||'');
  const comparedIds = new Set(compared.map(p=>String(p.id)));
  const reco1 = allProducts
    .filter(p=>!comparedIds.has(String(p.id)) && pCat(p) && (pCat(p)===compareCat || (isBag(compareCat)&&isBag(pCat(p)))))
    .map(p=>({p, m:matchPercent(input.quality, input.mood, scoreOf(scoreMap,p.id))}))
    .sort((a,b)=>b.m-a.m).slice(0,6).map(x=>x.p);

  // 추천 2: 어울리는 (다른 카테고리) — 취향타입 centroid 기준
  const c = type ? type.centroid : {};
  const cQ = {}, cM = {}; QKEYS.forEach(k=>cQ[k]=c[k]); MKEYS.forEach(k=>cM[k]=c[k]);
  const reco2 = allProducts
    .filter(p=>!comparedIds.has(String(p.id)) && pCat(p) && pCat(p)!==compareCat && !(isBag(compareCat)&&isBag(pCat(p))))
    .map(p=>({p, m:matchPercent(cQ, cM, scoreOf(scoreMap,p.id))}))
    .sort((a,b)=>b.m-a.m).slice(0,6).map(x=>x.p);

  const catLabel = isBag(compareCat) ? '가방' : (compareCat || '아이템');
  const tagChips = (type?.tags||[]).slice(0,3).map(t=>`<span class="match-chip">${t.replace(/^#/,'')}</span>`).join('');

  $app.innerHTML = `
    <header class="cr-header fade-up">
      <h1>비교 결과</h1>
      <p>당신의 취향을 분석해 가장 잘 어울리는 스타일을 찾았어요.</p>
    </header>

    <!-- 내가 비교한 상품들 -->
    <section class="cr-section fade-up" style="margin-top:8px;">
      <div class="cr-section-title">내가 비교한 상품들 <small>상품을 누르면 선택이 바뀌어요</small></div>
      <div class="cr-compared" id="comparedRow">
        ${compared.map(p=>`
          <div class="cmp-card ${String(p.id)===String(selectedId)?'is-selected':''}" data-id="${p.id}">
            <div class="cmp-thumb"><img src="${pImg(p)}" alt="${pName(p)}" onerror="this.style.opacity=.15"></div>
            <div class="cmp-name">${pName(p)}</div>
            <div class="cmp-price">${pPrice(p)}</div>
          </div>`).join('')}
      </div>
    </section>

    <!-- 선택 상품 구매 -->
    <section class="cr-buy fade-up">
      <div class="label">당신의 취향에 더 가까운 상품</div>
      <div class="picked">${pName(selProduct)}</div>
      <a class="cr-buy-btn" id="buyBtn" href="${ROUTE.checkout(selProduct?.id)}">${pName(selProduct)} 구매하기</a>
      <a class="cr-buy-close" href="${ROUTE.back}">고르지 않고 닫기</a>
    </section>

    <!-- 취향 타입 + 일치도 -->
    <section class="cr-section">
      <div class="cr-result-grid">
        <div class="taste-card fade-up">
          <div class="tc-text">
            <div class="tc-eyebrow">나의 취향 타입</div>
            <div class="tc-name">${type?.type_name_en||''}</div>
            <div class="tc-alias">${type?.type_name_kr||''}</div>
            <div class="tc-desc">${type?.description||''}</div>
            <div class="tc-tags">${(type?.tags||[]).map(t=>`<span class="tc-tag">${t}</span>`).join('')}</div>
          </div>
          <div class="tc-img"><img id="typeImg" src="${pImg(selProduct)}" alt="${pName(selProduct)}" onerror="this.style.opacity=.15"></div>
        </div>

        <div class="match-card fade-up">
          <div class="m-eyebrow">취향 일치도</div>
          <div class="gauge" id="gauge" style="--pct:${pct}">
            <div class="g-num" id="gNum">${pct}%</div>
            <div class="g-cap" id="gCap">${matchLabel(pct)}</div>
          </div>
          <div class="match-chips">${tagChips}</div>
        </div>
      </div>

      <!-- 선택 기준 요약 -->
      <div class="cr-summary fade-up">
        <div class="s-eyebrow">내가 선택한 기준</div>
        ${summary.map(l=>`<div>${l}</div>`).join('')}
      </div>
    </section>

    <!-- 추천 1 -->
    <section class="cr-section fade-up">
      <div class="cr-section-title">내 취향과 비슷한 ${catLabel}</div>
      <div class="cr-reco">${reco1.length?reco1.map(recoCard).join(''):'<div class="reco-empty">아직 비슷한 상품이 준비되지 않았어요.</div>'}</div>
    </section>

    <!-- 추천 2 -->
    <section class="cr-section fade-up">
      <div class="cr-section-title">함께 어울리는 키링 / 주얼리 / 지갑</div>
      <div class="cr-reco">${reco2.length?reco2.map(recoCard).join(''):'<div class="reco-empty">아직 어울리는 상품이 준비되지 않았어요.</div>'}</div>
    </section>

    <!-- CTA -->
    <a class="cr-cta fade-up" href="${ROUTE.recommend(type?.type_code||'')}">내 취향과 어울리는 다른 아이템 보러가기</a>
  `;

  wireEvents();
  markWishlisted();
}

function recoCard(p){
  return `
    <div class="reco-card" data-id="${p.id}">
      <div class="reco-thumb">
        <img src="${pImg(p)}" alt="${pName(p)}" onerror="this.style.opacity=.15">
        <button class="reco-heart" data-wish="${p.id}" aria-label="찜">
          <svg viewBox="0 0 24 24"><path class="hf" d="M12 21s-7.5-4.6-10-9.3C.7 9.2 1.6 5.8 4.6 5c2-.5 3.8.4 4.9 1.9C10.6 5.4 12.4 4.5 14.4 5c3 .8 3.9 4.2 2.6 6.7C19.5 16.4 12 21 12 21z"/></svg>
        </button>
      </div>
      <div class="reco-name">${pName(p)}</div>
      <div class="reco-price">${pPrice(p)}</div>
    </div>`;
}

/* ---------- 9. 이벤트 ---------- */
function wireEvents(){
  // 비교 상품 클릭 → 선택 전환 (타입명/설명/태그는 고정, %·이미지·구매버튼만 변경)
  document.querySelectorAll('#comparedRow .cmp-card').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id = el.getAttribute('data-id');
      if(String(id)===String(STATE.selectedId)) return;
      STATE.selectedId = id;
      updateSelected();
    });
  });
  // 추천 카드 클릭 → 상세 (하트는 제외)
  document.querySelectorAll('.reco-card').forEach(el=>{
    el.addEventListener('click', (e)=>{
      if(e.target.closest('[data-wish]')) return;
      location.href = ROUTE.productDetail(el.getAttribute('data-id'));
    });
  });
  // 하트 → 찜 토글
  document.querySelectorAll('[data-wish]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); toggleWish(btn); });
  });
}

function updateSelected(){
  const { compared, scoreMap, input } = STATE;
  const sel = compared.find(p=>String(p.id)===String(STATE.selectedId)) || compared[0];
  const pct = matchPercent(input.quality, input.mood, scoreOf(scoreMap, sel?.id));

  // 테두리
  document.querySelectorAll('#comparedRow .cmp-card').forEach(c=>{
    c.classList.toggle('is-selected', String(c.getAttribute('data-id'))===String(STATE.selectedId));
  });
  // 구매 영역
  document.querySelector('.cr-buy .picked').textContent = pName(sel);
  const buy = document.getElementById('buyBtn');
  buy.textContent = `${pName(sel)} 구매하기`;
  buy.href = ROUTE.checkout(sel?.id);
  // 타입 카드 이미지
  document.getElementById('typeImg').src = pImg(sel);
  // 일치도 (숫자만 변경)
  const g = document.getElementById('gauge');
  g.style.setProperty('--pct', pct);
  document.getElementById('gNum').textContent = pct+'%';
  document.getElementById('gCap').textContent = matchLabel(pct);
}

/* ---------- 10. 찜(wishlist) ---------- */
async function currentUser(){
  try { const { data:{ user } } = await sb.auth.getUser(); return user; } catch(e){ return null; }
}
async function markWishlisted(){
  const user = await currentUser(); if(!user) return;
  try{
    const { data } = await sb.from('wishlists').select('product_id').eq('user_id', user.id);
    const set = new Set((data||[]).map(w=>String(w.product_id)));
    document.querySelectorAll('[data-wish]').forEach(btn=>{
      if(set.has(String(btn.getAttribute('data-wish')))) btn.classList.add('on');
    });
  }catch(e){}
}
async function toggleWish(btn){
  const user = await currentUser();
  if(!user){ alert('찜은 로그인 후 이용할 수 있어요.'); return; }
  const pid = btn.getAttribute('data-wish');
  const on = btn.classList.contains('on');
  try{
    if(on){
      await sb.from('wishlists').delete().eq('user_id', user.id).eq('product_id', pid);
      btn.classList.remove('on');
    }else{
      await sb.from('wishlists').insert({ user_id:user.id, product_id:pid });
      btn.classList.add('on');
    }
  }catch(e){ console.error(e); }
}

/* ---------- 11. 시작 ---------- */
function showEmpty(){
  $app.innerHTML = `
    <div class="cr-empty">
      <h2>비교 정보가 없어요</h2>
      <p>다시 비교를 진행하면 결과를 보여드릴게요.</p>
      <a href="${ROUTE.back}">비교하러 가기</a>
    </div>`;
}

(async function init(){
  const input = readInput();
  if(!input){ showEmpty(); return; }
  try{
    const data = await loadData(input);
    if(!data.compared.length){ showEmpty(); return; }
    const type = pickTasteType(input.quality, input.mood, data.profiles);
    STATE = { input, ...data, type, selectedId: input.selected || String(data.compared[0].id) };
    render();
  }catch(e){
    console.error(e);
    showEmpty();
  }
})();
