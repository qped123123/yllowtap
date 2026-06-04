/* ============================================================
   Yllowtap 취향 비교 결과화면 V2  (compare-result-v2.js)
   1) URL products/selected + sessionStorage 슬라이더값 읽기
   2) 취향 타입(12개 중 1개) 판정
   3) 선택 상품 기준 취향 일치도 % (고정 공식, 랜덤 없음)
   4) 고객이 맞춘 슬라이더 그대로 표시 + 가장 세게 움직인 항목 3개 요약
   5) 비슷한/어울리는 상품 추천
   ============================================================ */

/* ---------- 0. 설정 ---------- */
const SUPABASE_URL  = 'https://ppihvvpplqikclftrwdb.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwaWh2dnBwbHFpa2NsZnRyd2RiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzE0NTEsImV4cCI6MjA5NTMwNzQ1MX0.shGVcFTQiuYc4u6tdU50x18YMgJdgFUljf8c7QlQU-U';   // ← Ctrl+H 로 실제 anon 키 치환

const ROUTE = {
  productDetail : (id) => `product.html?id=${id}`,
  checkout      : (id) => `checkout.html?selected=${id}`,
  back          : 'cart.html',
  recommend     : (code) => `recommend.html?type=${code}`
};
const SS_KEY = 'yllowtap_compare_v2';

const QKEYS  = ['storage','material','durability','finish','weight'];
const MKEYS  = ['minimal','color','cute_chic','daily_special'];
const QLABEL = {storage:'수납력',material:'소재',durability:'내구성',finish:'마감',weight:'무게'};
const MPOLE  = {minimal:['미니멀','데코'],color:['무채색','컬러'],cute_chic:['귀여움','시크'],daily_special:['데일리','스페셜']};

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
const $app = document.getElementById('crApp');

/* ---------- 1. 입력값 읽기 ---------- */
function readInput(){
  const url = new URLSearchParams(location.search);
  const demo = url.get('demo') === '1';
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch(e){}

  let quality, mood;
  if (saved && saved.quality && saved.mood){ quality = saved.quality; mood = saved.mood; }
  else if (demo){
    quality = {storage:8, material:8, durability:6, finish:7, weight:5};
    mood    = {minimal:-3, color:-2, cute_chic:2, daily_special:-2};
  } else { return null; }

  let products = (url.get('products')||'').split(',').map(s=>s.trim()).filter(Boolean);
  if (!products.length && saved && Array.isArray(saved.products)) products = saved.products.map(String);
  let selected = url.get('selected') || (saved && saved.selected) || products[0] || null;
  const category = (saved && saved.category) || null;
  return { quality, mood, products, selected:selected?String(selected):null, category, demo };
}

/* ---------- 2. 정규화 ---------- */
const clampQ = v => Math.max(0, Math.min(10, Number(v)||0));
const clampM = v => Math.max(-5, Math.min(5, Number(v)||0));
const nQ = v => clampQ(v)/10;
const nM = v => (clampM(v)+5)/10;
function vec9(q,m){ return [...QKEYS.map(k=>nQ(q[k])), ...MKEYS.map(k=>nM(m[k]))]; }
function dist(a,b){ let s=0; for(let i=0;i<a.length;i++){const d=a[i]-b[i]; s+=d*d;} return Math.sqrt(s); }

/* ---------- 3. 취향 타입 판정 ---------- */
function pickTasteType(quality, mood, profiles){
  const me = vec9(quality, mood);
  let best=null, bestD=Infinity;
  for(const p of profiles){
    const c = p.centroid || {};
    const cq={}, cm={}; QKEYS.forEach(k=>cq[k]=c[k]); MKEYS.forEach(k=>cm[k]=c[k]);
    const d = dist(me, vec9(cq, cm));
    if(d<bestD){ bestD=d; best=p; }
  }
  return best;
}

/* ---------- 4. 취향 일치도 % (55~99, 고정 공식) ---------- */
function matchPercent(quality, mood, score){
  let md=0; for(const k of MKEYS){ const d=clampM(mood[k])-clampM(score[k+'_score']); md+=d*d; }
  const moodScore = 1 - Math.sqrt(md)/20;
  let sumW=0,sumWS=0,penalty=0;
  for(const k of QKEYS){
    const imp=clampQ(quality[k]), lvl=clampQ(score[k+'_score']);
    sumW+=imp; sumWS+=imp*lvl; if(lvl<=2) penalty+=0.03;
  }
  const qFit = sumW>0 ? (sumWS/(sumW*10)) : 0.6;
  const qualityScore = Math.max(0, Math.min(1, qFit - penalty));
  const raw = 0.5*moodScore + 0.5*qualityScore;
  return Math.max(55, Math.min(99, Math.round(55 + raw*44)));
}
function matchLabel(p){ return p>=90?'매우 잘 맞아요':p>=80?'잘 맞아요':p>=70?'꽤 맞아요':'무난하게 맞아요'; }

/* ---------- 5. 선택 기준 요약 (가장 세게 움직인 3개 + 조사) ---------- */
function hasJong(str){
  if(!str) return false;
  const c = str.charCodeAt(str.length-1);
  if(c<0xAC00||c>0xD7A3) return false;
  return (c-0xAC00)%28 !== 0;
}
const objParticle = s => hasJong(s) ? '을' : '를';

function buildSummary(quality, mood){
  const items = [];
  for(const k of QKEYS){
    const v = clampQ(quality[k]);
    items.push({ label: QLABEL[k], emph: Math.max(0, v-5)/5 });   // 중요도 5 초과분
  }
  const moodWord = {
    minimal:       v=> v<0?'미니멀한 무드':'데코 무드',
    color:         v=> v<0?'무채색 무드':'컬러 무드',
    cute_chic:     v=> v<0?'귀여운 무드':'시크한 무드',
    daily_special: v=> v<0?'데일리한 무드':'스페셜한 무드'
  };
  for(const k of MKEYS){
    const v = clampM(mood[k]);
    items.push({ label: moodWord[k](v), emph: Math.abs(v)/5 });   // 중앙에서 벗어난 정도
  }
  const top = items.filter(i=>i.emph>0.001).sort((a,b)=>b.emph-a.emph).slice(0,3);
  if(!top.length) return ['특정 항목에 치우치지 않고, 전반적으로 균형 있게 보는 편이에요.'];
  const labels = top.map(i=>i.label);
  return [`${labels.join(', ')}${objParticle(labels[labels.length-1])} 특히 중요하게 보셨어요.`];
}

/* ---------- 6. 상품 필드 ---------- */
const pImg   = p => p.image_url || p.image || p.thumbnail || p.thumbnail_url || (Array.isArray(p.images)&&p.images[0]) || '';
const pName  = p => p.name || p.title || p.product_name || '상품';
const pPrice = p => Number(p.price ?? p.sale_price ?? 0).toLocaleString('ko-KR')+'원';
const pCat   = p => (p.category || p.cat || '').toString();
const isBag  = c => /bag|가방/i.test(c||'');

/* ---------- 7. 데이터 로드 ---------- */
async function loadData(input){
  const { data:profiles } = await sb.from('taste_profiles').select('*').eq('is_active',true).order('sort_order');
  let compared = [];
  if(input.products.length){
    const { data } = await sb.from('products').select('*').in('id', input.products);
    const map={}; (data||[]).forEach(p=>map[String(p.id)]=p);
    compared = input.products.map(id=>map[id]).filter(Boolean);
  }
  if(!compared.length && input.demo){
    const { data } = await sb.from('products').select('*').limit(3);
    compared = data||[]; if(compared.length && !input.selected) input.selected=String(compared[0].id);
  }
  const { data:allProducts } = await sb.from('products').select('*').limit(300);
  const { data:scoresArr }   = await sb.from('vw_product_taste_scores').select('*');
  const scoreMap={}; (scoresArr||[]).forEach(s=>scoreMap[String(s.product_id)]=s);
  return { profiles:profiles||[], compared, allProducts:allProducts||[], scoreMap };
}
function scoreOf(map,id){
  return map[String(id)] || {storage_score:5,material_score:5,durability_score:5,finish_score:5,weight_score:5,minimal_score:0,color_score:0,cute_chic_score:0,daily_special_score:0};
}

/* ---------- 8. 슬라이더 불러오기(읽기전용) ---------- */
function renderSliders(input){
  const q=input.quality, m=input.mood;
  const qRow = k=>{
    const pos = clampQ(q[k])/10*100;
    return `<div class="sld-row"><span class="sld-label">${QLABEL[k]}</span>
      <div class="sld-track"><div class="sld-dot" style="left:${pos}%"></div></div>
      <span class="sld-pole-r"></span></div>`;
  };
  const mRow = k=>{
    const pos = (clampM(m[k])+5)/10*100; const [lo,hi]=MPOLE[k];
    return `<div class="sld-row"><span class="sld-label">${lo}</span>
      <div class="sld-track"><div class="sld-dot" style="left:${pos}%"></div></div>
      <span class="sld-pole-r">${hi}</span></div>`;
  };
  return `
    <div class="sld-group-title">품질 <small>높을수록 중요하게 생각해요</small></div>
    <div class="sld-rows">${QKEYS.map(qRow).join('')}</div>
    <div class="sld-group-title">무드 <small>선호하는 방향이에요</small></div>
    <div class="sld-rows">${MKEYS.map(mRow).join('')}</div>`;
}

/* ---------- 9. 렌더 ---------- */
let STATE = {};
function render(){
  const { input, profiles, compared, allProducts, scoreMap, type, selectedId } = STATE;
  const sel = compared.find(p=>String(p.id)===String(selectedId)) || compared[0];
  const pct = matchPercent(input.quality, input.mood, scoreOf(scoreMap, sel?.id));
  const summary = buildSummary(input.quality, input.mood);

  const compareCat = pCat(sel) || (input.category||'');
  const ids = new Set(compared.map(p=>String(p.id)));
  const reco1 = allProducts
    .filter(p=>!ids.has(String(p.id)) && pCat(p) && (pCat(p)===compareCat || (isBag(compareCat)&&isBag(pCat(p)))))
    .map(p=>({p,m:matchPercent(input.quality,input.mood,scoreOf(scoreMap,p.id))}))
    .sort((a,b)=>b.m-a.m).slice(0,6).map(x=>x.p);
  const c = type?type.centroid:{}; const cQ={},cM={}; QKEYS.forEach(k=>cQ[k]=c[k]); MKEYS.forEach(k=>cM[k]=c[k]);
  const reco2 = allProducts
    .filter(p=>!ids.has(String(p.id)) && pCat(p) && pCat(p)!==compareCat && !(isBag(compareCat)&&isBag(pCat(p))))
    .map(p=>({p,m:matchPercent(cQ,cM,scoreOf(scoreMap,p.id))}))
    .sort((a,b)=>b.m-a.m).slice(0,6).map(x=>x.p);

  const catLabel = isBag(compareCat)?'가방':(compareCat||'아이템');
  const chips = (type?.tags||[]).slice(0,3).map(t=>`<span class="match-chip">${t.replace(/^#/,'')}</span>`).join('');

  $app.innerHTML = `
    <header class="cr-header fade-up">
      <h1>비교 결과</h1>
      <p>당신의 취향을 분석해 가장 잘 어울리는 스타일을 찾았어요.</p>
    </header>

    <div class="cr-grid">
      <!-- 좌: 비교상품 / 구매 / 슬라이더 / 기준 -->
      <div class="col-left">
        <section class="blk fade-up">
          <div class="blk-title">내가 비교한 상품들 <small>상품을 누르면 선택이 바뀌어요</small></div>
          <div class="cr-compared" id="comparedRow">
            ${compared.map(p=>`
              <div class="cmp-card ${String(p.id)===String(selectedId)?'is-selected':''}" data-id="${p.id}">
                <div class="cmp-thumb"><img src="${pImg(p)}" alt="${pName(p)}" onerror="this.style.opacity=.15"></div>
                <div class="cmp-name">${pName(p)}</div>
                <div class="cmp-price">${pPrice(p)}</div>
              </div>`).join('')}
          </div>
        </section>

        <section class="cr-buy fade-up">
          <div class="label">당신의 취향에 더 가까운 상품</div>
          <div class="picked">${pName(sel)}</div>
          <a class="cr-buy-btn" id="buyBtn" href="${ROUTE.checkout(sel?.id)}">${pName(sel)} 구매하기</a>
          <a class="cr-buy-close" href="${ROUTE.back}">고르지 않고 닫기</a>
        </section>

        <section class="cr-sliders fade-up">${renderSliders(input)}</section>

        <section class="cr-summary fade-up">
          <div class="s-eyebrow">내가 선택한 기준</div>
          ${summary.map(l=>`<div>${l}</div>`).join('')}
        </section>
      </div>

      <!-- 우: 타입+일치도 / 추천 / CTA -->
      <div class="col-right">
        <div class="cr-type-gauge fade-up">
          <div class="taste-card">
            <div class="tc-text">
              <div class="tc-eyebrow">나의 취향 타입</div>
              <div class="tc-name serif">${type?.type_name_en||''}</div>
              <div class="tc-alias">${type?.type_name_kr||''}</div>
              <div class="tc-desc">${type?.description||''}</div>
              <div class="tc-tags">${(type?.tags||[]).map(t=>`<span class="tc-tag">${t}</span>`).join('')}</div>
            </div>
            <div class="tc-img"><img id="typeImg" src="${pImg(sel)}" alt="${pName(sel)}" onerror="this.style.opacity=.15"></div>
          </div>
          <div class="match-card">
            <div class="m-eyebrow">취향 일치도</div>
            <div class="gauge" id="gauge" style="--pct:${pct}">
              <div class="g-num" id="gNum">${pct}%</div>
              <div class="g-cap" id="gCap">${matchLabel(pct)}</div>
            </div>
            <div class="match-chips">${chips}</div>
          </div>
        </div>

        <section class="blk fade-up">
          <div class="blk-title">내 취향과 비슷한 ${catLabel}</div>
          <div class="cr-reco">${reco1.length?reco1.map(recoCard).join(''):'<div class="reco-empty">아직 비슷한 상품이 준비되지 않았어요.</div>'}</div>
        </section>

        <section class="blk fade-up">
          <div class="blk-title">함께 어울리는 키링 / 주얼리 / 지갑</div>
          <div class="cr-reco">${reco2.length?reco2.map(recoCard).join(''):'<div class="reco-empty">아직 어울리는 상품이 준비되지 않았어요.</div>'}</div>
        </section>

        <a class="cr-cta fade-up" href="${ROUTE.recommend(type?.type_code||'')}">내 취향과 어울리는 다른 아이템 보러가기</a>
      </div>
    </div>`;

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

/* ---------- 10. 이벤트 ---------- */
function wireEvents(){
  document.querySelectorAll('#comparedRow .cmp-card').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id=el.getAttribute('data-id');
      if(String(id)===String(STATE.selectedId)) return;
      STATE.selectedId=id; updateSelected();
    });
  });
  document.querySelectorAll('.reco-card').forEach(el=>{
    el.addEventListener('click', e=>{ if(e.target.closest('[data-wish]')) return; location.href=ROUTE.productDetail(el.getAttribute('data-id')); });
  });
  document.querySelectorAll('[data-wish]').forEach(btn=>{
    btn.addEventListener('click', e=>{ e.stopPropagation(); toggleWish(btn); });
  });
}
function updateSelected(){
  const { compared, scoreMap, input } = STATE;
  const sel = compared.find(p=>String(p.id)===String(STATE.selectedId)) || compared[0];
  const pct = matchPercent(input.quality, input.mood, scoreOf(scoreMap, sel?.id));
  document.querySelectorAll('#comparedRow .cmp-card').forEach(c=>c.classList.toggle('is-selected', String(c.getAttribute('data-id'))===String(STATE.selectedId)));
  document.querySelector('.cr-buy .picked').textContent = pName(sel);
  const buy=document.getElementById('buyBtn'); buy.textContent=`${pName(sel)} 구매하기`; buy.href=ROUTE.checkout(sel?.id);
  document.getElementById('typeImg').src = pImg(sel);
  const g=document.getElementById('gauge'); g.style.setProperty('--pct',pct);
  document.getElementById('gNum').textContent=pct+'%';
  document.getElementById('gCap').textContent=matchLabel(pct);
}

/* ---------- 11. 찜 ---------- */
async function currentUser(){ try{ const {data:{user}}=await sb.auth.getUser(); return user; }catch(e){ return null; } }
async function markWishlisted(){
  const user=await currentUser(); if(!user) return;
  try{
    const { data }=await sb.from('wishlists').select('product_id').eq('user_id',user.id);
    const set=new Set((data||[]).map(w=>String(w.product_id)));
    document.querySelectorAll('[data-wish]').forEach(b=>{ if(set.has(String(b.getAttribute('data-wish')))) b.classList.add('on'); });
  }catch(e){}
}
async function toggleWish(btn){
  const user=await currentUser();
  if(!user){ alert('찜은 로그인 후 이용할 수 있어요.'); return; }
  const pid=btn.getAttribute('data-wish'), on=btn.classList.contains('on');
  try{
    if(on){ await sb.from('wishlists').delete().eq('user_id',user.id).eq('product_id',pid); btn.classList.remove('on'); }
    else  { await sb.from('wishlists').insert({user_id:user.id,product_id:pid}); btn.classList.add('on'); }
  }catch(e){ console.error(e); }
}

/* ---------- 12. 시작 ---------- */
function showEmpty(){
  $app.innerHTML = `<div class="cr-empty"><h2>비교 정보가 없어요</h2><p>다시 비교를 진행하면 결과를 보여드릴게요.</p><a href="${ROUTE.back}">비교하러 가기</a></div>`;
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
  }catch(e){ console.error(e); showEmpty(); }
})();