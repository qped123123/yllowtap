/* ============================================================
   Yllowtap 취향 비교 결과화면 V2  (compare-result-v2.js)
   - 카드 3개로 묶음 / 이미지 정사각 / 타입 이미지는 고정(게이지 바·일치% 만 변경)
   ============================================================ */

/* ---------- 0. 설정 ---------- */
const SUPABASE_URL  = 'https://ppihvvpplqikclftrwdb.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwaWh2dnBwbHFpa2NsZnRyd2RiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzE0NTEsImV4cCI6MjA5NTMwNzQ1MX0.shGVcFTQiuYc4u6tdU50x18YMgJdgFUljf8c7QlQU-U';   // ← Ctrl+H 로 실제 anon 키 치환

const ROUTE = {
  detail        : (slug, id) => slug ? `product?slug=${slug}` : `product?id=${id}`,
  checkout      : (id) => `checkout.html?selected=${id}`,
  back          : 'cart.html',
  recommend     : (code) => `recommend.html?type=${code}`
};
const SS_KEY = 'yllowtap_compare_v2';
const QKEYS  = ['storage','material','durability','finish','weight'];
const MKEYS  = ['minimal','color','cute_chic','daily_special'];
const QLABEL = {storage:'수납력',material:'소재',durability:'내구성',finish:'마감',weight:'무게'};
const MPOLE  = {minimal:['미니멀','데코'],color:['무채색','컬러'],cute_chic:['귀여움','시크'],daily_special:['데일리','스페셜']};
const CAT_LABEL = {bags:'BAGS', bag:'BAGS', jewelry:'JEWELRY', accessories:'ACCESSORIES', keyring:'KEYRING'};
const catLbl = c => CAT_LABEL[String(c||'').toLowerCase()] || (c?String(c).toUpperCase():'아이템');

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
const $app = document.getElementById('crApp');

/* ---------- 1. 입력 ---------- */
function readInput(){
  const url = new URLSearchParams(location.search);
  const demo = url.get('demo') === '1';
  let saved=null; try{ saved=JSON.parse(sessionStorage.getItem(SS_KEY)||'null'); }catch(e){}
  let quality, mood;
  if(saved&&saved.quality&&saved.mood){ quality=saved.quality; mood=saved.mood; }
  else if(demo){ quality={storage:8,material:8,durability:6,finish:7,weight:5}; mood={minimal:-3,color:-2,cute_chic:2,daily_special:-2}; }
  else return null;
  let products=(url.get('products')||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!products.length&&saved&&Array.isArray(saved.products)) products=saved.products.map(String);
  let selected=url.get('selected')||(saved&&saved.selected)||products[0]||null;
  return { quality, mood, products, selected:selected?String(selected):null, category:(saved&&saved.category)||null, demo };
}

/* ---------- 2. 정규화 ---------- */
const clampQ=v=>Math.max(0,Math.min(10,Number(v)||0));
const clampM=v=>Math.max(-5,Math.min(5,Number(v)||0));
const nQ=v=>clampQ(v)/10, nM=v=>(clampM(v)+5)/10;
function vec9(q,m){ return [...QKEYS.map(k=>nQ(q[k])),...MKEYS.map(k=>nM(m[k]))]; }
function dist(a,b){ let s=0; for(let i=0;i<a.length;i++){const d=a[i]-b[i];s+=d*d;} return Math.sqrt(s); }

/* ---------- 3. 타입 판정 ---------- */
function pickTasteType(q,m,profiles){
  const me=vec9(q,m); let best=null,bd=Infinity;
  for(const p of profiles){ const c=p.centroid||{}; const cq={},cm={}; QKEYS.forEach(k=>cq[k]=c[k]); MKEYS.forEach(k=>cm[k]=c[k]);
    const d=dist(me,vec9(cq,cm)); if(d<bd){bd=d;best=p;} }
  return best;
}

/* ---------- 4. 일치도 % ---------- */
function matchPercent(quality,mood,score){
  let md=0; for(const k of MKEYS){ const d=clampM(mood[k])-clampM(score[k+'_score']); md+=d*d; }
  const moodScore=1-Math.sqrt(md)/20;
  let sumW=0,sumWS=0,penalty=0;
  for(const k of QKEYS){ const imp=clampQ(quality[k]),lvl=clampQ(score[k+'_score']); sumW+=imp; sumWS+=imp*lvl; if(lvl<=2)penalty+=0.03; }
  const qFit=sumW>0?(sumWS/(sumW*10)):0.6;
  const qs=Math.max(0,Math.min(1,qFit-penalty));
  return Math.max(55,Math.min(99,Math.round(55+(0.5*moodScore+0.5*qs)*44)));
}
const matchLabel=p=>p>=80?'가장 잘 맞아요':p>=70?'잘 맞아요':p>=60?'무난해요':'글쎄요';
// 게이지 라벨: 비교 상품 중 1순위(가장 높은 점수)는 항상 '가장 잘 맞아요',
// 2·3순위는 점수로 (80↑ 잘 맞아요 / 70~79 무난해요 / 70미만 글쎄요)
function gaugeInfo(sel){
  const {compared, scoreMap, input}=STATE;
  const scored=compared.map(p=>({id:String(p.id), m:matchPercent(input.quality,input.mood,scoreOf(scoreMap,p.id))})).sort((a,b)=>b.m-a.m);
  const mine=scored.find(x=>x.id===String(sel.id))||scored[0];
  const rank=scored.findIndex(x=>x.id===String(mine.id));
  const pct=mine.m;
  const label = rank===0 ? '가장 잘 맞아요' : pct>=80 ? '잘 맞아요' : pct>=70 ? '무난해요' : '글쎄요';
  return {pct, label};
}

/* ---------- 5. 기준 요약(상위 3개 + 조사) ---------- */
function hasJong(s){ if(!s)return false; const c=s.charCodeAt(s.length-1); if(c<0xAC00||c>0xD7A3)return false; return (c-0xAC00)%28!==0; }
const objParticle=s=>hasJong(s)?'을':'를';
function buildSummary(quality,mood){
  const items=[];
  for(const k of QKEYS){ const v=clampQ(quality[k]); items.push({label:QLABEL[k],emph:Math.max(0,v-5)/5}); }
  const mw={ minimal:v=>v<0?'미니멀한 무드':'데코 무드', color:v=>v<0?'무채색 무드':'컬러 무드',
    cute_chic:v=>v<0?'귀여운 무드':'시크한 무드', daily_special:v=>v<0?'데일리한 무드':'스페셜한 무드' };
  for(const k of MKEYS){ const v=clampM(mood[k]); items.push({label:mw[k](v),emph:Math.abs(v)/5}); }
  const top=items.filter(i=>i.emph>0.001).sort((a,b)=>b.emph-a.emph).slice(0,3);
  if(!top.length) return '특정 항목에 치우치지 않고, 전반적으로 균형 있게 보는 편이에요.';
  const labels=top.map(i=>i.label);
  return `${labels.join(', ')}${objParticle(labels[labels.length-1])} 특히 중요하게 보셨어요.`;
}

/* ---------- 6. 상품 필드 ---------- */
const pImg=p=>p.image_url||p.image||p.thumbnail||p.thumbnail_url||(Array.isArray(p.images)&&p.images[0])||'';
const pName=p=>p.name||p.title||p.product_name||'상품';
const won=n=>Number(n||0).toLocaleString('ko-KR')+'원';
const num=v=>{const n=Number(v);return isFinite(n)?n:0;};
function priceHTML(p){
  const sell=num(p.price), orig=num(p.original_price);
  if(orig>0 && sell>0 && orig>sell){
    const rate=Math.round((orig-sell)/orig*100);
    return `<span class="price-orig">${won(orig)}</span><span class="price-now"><span class="price-main">${won(sell)}</span><span class="price-rate">${rate}%</span></span>`;
  }
  return `<span class="price-main">${won(sell||orig)}</span>`;
}
const pCat=p=>(p.category||p.cat||'').toString();
const isBag=c=>/bag|가방/i.test(c||'');

/* ---------- 7. 로드 ---------- */
async function loadData(input){
  const { data:profiles }=await sb.from('taste_profiles').select('*').eq('is_active',true).order('sort_order');
  let compared=[];
  if(input.products.length){ const {data}=await sb.from('products').select('*').in('id',input.products);
    const map={}; (data||[]).forEach(p=>map[String(p.id)]=p); compared=input.products.map(id=>map[id]).filter(Boolean); }
  if(!compared.length&&input.demo){ const {data}=await sb.from('products').select('*').limit(60);
    const all=data||[]; const byCat={}; all.forEach(p=>{const c=pCat(p)||'_'; (byCat[c]=byCat[c]||[]).push(p);});
    let pick=[]; for(const c in byCat){ if(byCat[c].length>=2){ pick=byCat[c].slice(0,3); break; } }
    compared = pick.length?pick:all.slice(0,3);
    if(compared.length&&!input.selected) input.selected=String(compared[0].id); }
  const { data:allProducts }=await sb.from('products').select('*').limit(300);
  const { data:scoresArr }=await sb.from('vw_product_taste_scores').select('*');
  const scoreMap={}; (scoresArr||[]).forEach(s=>scoreMap[String(s.product_id)]=s);
  return { profiles:profiles||[], compared, allProducts:allProducts||[], scoreMap };
}
const scoreOf=(map,id)=>map[String(id)]||{storage_score:5,material_score:5,durability_score:5,finish_score:5,weight_score:5,minimal_score:0,color_score:0,cute_chic_score:0,daily_special_score:0};

/* ---------- 8. 슬라이더 ---------- */
function renderSliders(input){
  const q=input.quality,m=input.mood;
  const qRow=k=>`<div class="sld-row"><span class="sld-label">${QLABEL[k]}</span><div class="sld-track"><div class="sld-dot" style="left:${clampQ(q[k])/10*100}%"></div></div><span class="sld-pole-r"></span></div>`;
  const mRow=k=>{const [lo,hi]=MPOLE[k];return `<div class="sld-row"><span class="sld-label">${lo}</span><div class="sld-track"><div class="sld-dot" style="left:${(clampM(m[k])+5)/10*100}%"></div></div><span class="sld-pole-r">${hi}</span></div>`;};
  return `<div class="sld-group-title">품질 <small>높을수록 중요하게 생각해요</small></div><div class="sld-rows">${QKEYS.map(qRow).join('')}</div>
    <div class="sld-group-title">무드 <small>선호하는 방향이에요</small></div><div class="sld-rows">${MKEYS.map(mRow).join('')}</div>`;
}

/* ---------- 9. 렌더 ---------- */
let STATE={};
function render(){
  const { input, compared, allProducts, scoreMap, type, selectedId } = STATE;
  const sel=compared.find(p=>String(p.id)===String(selectedId))||compared[0];
  STATE.fixedImg = pImg(sel); // 타입 카드 이미지는 고정 — 처음 선택 상품으로 박고 이후 안 바뀜
  const g=gaugeInfo(sel); const pct=g.pct;
  const summary=buildSummary(input.quality,input.mood);

  const compareCat=pCat(sel)||(input.category||'');
  const ids=new Set(compared.map(p=>String(p.id)));
  const reco1=allProducts.filter(p=>!ids.has(String(p.id))&&pCat(p)&&(pCat(p)===compareCat||(isBag(compareCat)&&isBag(pCat(p)))))
    .map(p=>({p,m:matchPercent(input.quality,input.mood,scoreOf(scoreMap,p.id))})).sort((a,b)=>b.m-a.m).slice(0,6).map(x=>x.p);
  const c=type?type.centroid:{}; const cQ={},cM={}; QKEYS.forEach(k=>cQ[k]=c[k]); MKEYS.forEach(k=>cM[k]=c[k]);
  const otherCatList=[...new Set(allProducts.map(p=>pCat(p)).filter(x=>x && x!==compareCat && !(isBag(compareCat)&&isBag(x))))];
  let reco2=[];
  otherCatList.forEach(cat=>{
    const items=allProducts.filter(p=>!ids.has(String(p.id)) && pCat(p)===cat)
      .map(p=>({p,m:matchPercent(cQ,cM,scoreOf(scoreMap,p.id))})).sort((a,b)=>b.m-a.m).slice(0,3).map(x=>x.p);
    reco2=reco2.concat(items);
  });

  const catLabel=catLbl(compareCat);
  const otherCats=[...new Set(reco2.map(p=>catLbl(pCat(p))))];
  const otherLabel=otherCats.length?otherCats.join(' / '):'다른 아이템';
  const chips=(type?.tags||[]).slice(0,3).map(t=>`<span class="match-chip">${t.replace(/^#/,'')}</span>`).join('');

  // 공유받은 사람이 보는 화면이면(=share) 저장/공유 대신 "내 취향 비교하기" CTA만
  const shareView = !!input.share;
  const actionsHtml = shareView
    ? `<div class="cr-actions" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;margin:36px auto 0;max-width:600px;"><a href="/" style="flex:0 0 auto;height:44px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:7px;background:#fff;color:#1a1a1a;border:1px solid #1a1a1a;border-radius:14px;font-size:14px;font-weight:600;padding:0 22px;text-decoration:none;transition:background .15s,color .15s;" onmouseover="this.style.background='#1a1a1a';this.style.color='#fff';" onmouseout="this.style.background='#fff';this.style.color='#1a1a1a';">옐로탭에서 내 취향 비교하기</a></div>`
    : `<div class="cr-actions" style="display:flex;flex-wrap:nowrap;gap:8px;align-items:center;justify-content:center;margin:36px auto 0;"><a href="${ROUTE.back}" style="flex:0 1 auto;min-width:0;height:44px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;background:#fff;color:#1a1a1a;border:1px solid #1a1a1a;border-radius:14px;font-size:13px;font-weight:600;padding:0 14px;text-decoration:none;white-space:nowrap;transition:background .15s,color .15s;" onmouseover="this.style.background='#1a1a1a';this.style.color='#fff';" onmouseout="this.style.background='#fff';this.style.color='#1a1a1a';"><span style="font-size:15px;line-height:1;">&#8592;</span> 장바구니로 돌아가기</a><button type="button" onclick="shareComparison(this)" style="flex:0 0 auto;height:44px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;background:#fff;color:#1a1a1a;border:1px solid #1a1a1a;border-radius:14px;font-size:13px;font-weight:600;padding:0 14px;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .15s,color .15s;" onmouseover="this.style.background='#1a1a1a';this.style.color='#fff';" onmouseout="this.style.background='#fff';this.style.color='#1a1a1a';"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>공유</button><button type="button" onclick="saveComparison(this)" style="flex:0 0 auto;height:44px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;background:#fff;color:#1a1a1a;border:1px solid #1a1a1a;border-radius:14px;font-size:13px;font-weight:600;padding:0 14px;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .15s,color .15s;" onmouseover="this.style.background='#1a1a1a';this.style.color='#fff';" onmouseout="this.style.background='#fff';this.style.color='#1a1a1a';"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>저장</button></div>`;

  $app.innerHTML=`
    <header class="cr-header fade-up">
      <div class="cr-brand">YLLOWTAP</div>
      <h1>비교 결과</h1>
      <p>당신의 취향을 분석해 가장 잘 어울리는 스타일을 찾았어요.</p>
    </header>

    <div class="cr-grid">
      <div class="col-left">
        <!-- 카드 1: 비교 상품(흰바탕) + 구매 -->
        <div class="cr-card white-card fade-up">
          <div class="blk-title">내가 비교한 상품들 <small>상품을 누르면 취향 일치도가 바뀌어요</small></div>
          <div class="cmp-panel">
            <div class="cr-compared" id="comparedRow">
              ${compared.map(p=>`
                <div class="cmp-card ${String(p.id)===String(selectedId)?'is-selected':''}" data-id="${p.id}">
                  <div class="cmp-thumb"><img src="${pImg(p)}" alt="${pName(p)}" onerror="this.style.opacity=.15"></div>
                  <div class="cmp-name">${pName(p)}</div>
                  <div class="cmp-price">${priceHTML(p)}</div>
                </div>`).join('')}
            </div>
          </div>
          <div class="buy-area">
            <div class="label">당신의 취향에 더 가까운 상품</div>
            <a class="cr-buy-btn" id="buyBtn" href="${ROUTE.checkout(sel?.id)}">${pName(sel)} 구매하기</a>
            <a class="cr-buy-close" href="${ROUTE.back}">고르지 않고 닫기</a>
          </div>
        </div>

        <!-- 카드 2: 슬라이더 + 기준 -->
        <div class="cr-card fade-up">
          ${renderSliders(input)}
          <div class="criteria">
            <div class="s-eyebrow">내가 선택한 기준</div>
            <div class="s-text" id="criteriaText">${summary}</div>
          </div>
        </div>
      </div>

      <div class="col-right">
        <!-- 카드 3: 타입 + 일치도 -->
        <div class="cr-card cr-type-gauge fade-up">
          <div class="taste-region">
            <div class="tc-text">
              <div class="tc-eyebrow">나의 취향 타입</div>
              <div class="tc-name serif">${type?.type_name_en||''}</div>
              <div class="tc-alias">${type?.type_name_kr||''}</div>
              <div class="tc-desc">${type?.description||''}</div>
              <div class="tc-tags">${(type?.tags||[]).map(t=>`<span class="tc-tag">${t}</span>`).join('')}</div>
            </div>
            <div class="tc-img"><img src="${STATE.fixedImg}" alt="${pName(sel)}" onerror="this.style.opacity=.15"></div>
          </div>
          <div class="gauge-region">
            <div class="m-eyebrow">취향 일치도</div>
            <div class="gauge" id="gauge" style="--pct:${pct}">
              <div class="g-num" id="gNum">${pct}%</div>
              <div class="g-cap" id="gCap">${g.label}</div>
            </div>
            <div class="match-chips">${chips}</div>
          </div>
        </div>

        <div class="cr-reco-banner">내 취향과 어울리는 다른 아이템</div>

        <section class="fade-up">
          <div class="blk-title">내 취향과 비슷한 ${catLabel}</div>
          <div class="cr-reco">${reco1.length?reco1.map(recoCard).join(''):'<div class="reco-empty">아직 비슷한 상품이 준비되지 않았어요.</div>'}</div>
        </section>
        <section class="fade-up">
          <div class="blk-title">함께 어울리는 ${otherLabel}</div>
          <div class="cr-reco">${reco2.length?reco2.map(recoCard).join(''):'<div class="reco-empty">아직 어울리는 상품이 준비되지 않았어요.</div>'}</div>
        </section>
      </div>
    </div>
    ${actionsHtml}`;

  wireEvents(); markWishlisted();
}

function recoCard(p){
  return `<div class="reco-card" data-id="${p.id}" data-slug="${p.slug||''}">
    <div class="reco-thumb"><img src="${pImg(p)}" alt="${pName(p)}" onerror="this.style.opacity=.15">
      <button class="reco-heart" data-wish="${p.id}" aria-label="찜">
        <svg viewBox="0 0 24 24"><path class="hf" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>
      </button>
    </div>
    <div class="reco-name">${pName(p)}</div>
    <div class="reco-price">${priceHTML(p)}</div>
    <a class="reco-view" href="${ROUTE.detail(p.slug, p.id)}">보러가기</a>
  </div>`;
}

/* ---------- 10. 이벤트 ---------- */
function wireEvents(){
  document.querySelectorAll('#comparedRow .cmp-card').forEach(el=>el.addEventListener('click',()=>{
    const id=el.getAttribute('data-id'); if(String(id)===String(STATE.selectedId))return;
    STATE.selectedId=id; updateSelected();
  }));
  document.querySelectorAll('.reco-card').forEach(el=>el.addEventListener('click',e=>{
    if(e.target.closest('[data-wish], .reco-view'))return; location.href=ROUTE.detail(el.getAttribute('data-slug'), el.getAttribute('data-id'));
  }));
  document.querySelectorAll('[data-wish]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();toggleWish(btn);}));
}
function updateSelected(){
  const { compared, scoreMap, input } = STATE;
  const sel=compared.find(p=>String(p.id)===String(STATE.selectedId))||compared[0];
  const info=gaugeInfo(sel); const pct=info.pct;
  document.querySelectorAll('#comparedRow .cmp-card').forEach(c=>c.classList.toggle('is-selected',String(c.getAttribute('data-id'))===String(STATE.selectedId)));
  const buy=document.getElementById('buyBtn'); buy.textContent=`${pName(sel)} 구매하기`; buy.href=ROUTE.checkout(sel?.id);
  const g=document.getElementById('gauge'); g.style.setProperty('--pct',pct);
  document.getElementById('gNum').textContent=pct+'%';
  document.getElementById('gCap').textContent=info.label;
  // ※ 타입 카드 이미지는 고정 — 바꾸지 않음 (게이지 바·숫자만 변경)
}

/* ---------- 10-1. 저장 / 공유 ---------- */
function crToast(msg){
  let t=document.getElementById('crToast');
  if(!t){ t=document.createElement('div'); t.id='crToast';
    t.style.cssText='position:fixed;left:50%;bottom:32px;transform:translateX(-50%) translateY(10px);background:#1a1a1a;color:#fff;padding:13px 22px;border-radius:999px;font-size:13.5px;font-weight:500;opacity:0;transition:opacity .2s,transform .2s;z-index:9999;pointer-events:none;';
    document.body.appendChild(t); }
  t.textContent=msg; requestAnimationFrame(()=>{ t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)'; });
  clearTimeout(t._tm); t._tm=setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(10px)'; }, 2200);
}

// 그날 결과를 통째로 스냅샷으로 (나중에 상품이 바뀌어도 그대로 보이게)
function buildSnapshot(){
  const { input, compared, type, scoreMap } = STATE;
  return {
    category: input.category || pCat(compared[0]) || null,
    quality: input.quality, mood: input.mood,
    selectedId: String(STATE.selectedId),
    type: type || null,
    products: compared.map(p=>({
      id:String(p.id), name:pName(p), img:pImg(p),
      price:(p.price??null), original_price:(p.original_price??null), slug:(p.slug||null),
      match: matchPercent(input.quality,input.mood,scoreOf(scoreMap,p.id))
    }))
  };
}

// 저장·공유 공용 — 한 번만 insert하고 share_id를 캐시해 중복 줄 방지
async function ensureSaved(){
  if(STATE.savedShareId) return STATE.savedShareId;
  const { data:{ user } } = await sb.auth.getUser();
  if(!user){ location.href='/login.html?redirect='+encodeURIComponent(location.pathname+location.search); return null; }
  const snap = buildSnapshot();
  const { data, error } = await sb.from('saved_comparisons').insert({
    user_id: user.id,
    category: snap.category,
    type_name: snap.type?.type_name_en || snap.type?.type_name_kr || null,
    snapshot: snap
  }).select('share_id').single();
  if(error || !data){ console.error(error); throw new Error(error?.message||'save failed'); }
  STATE.savedShareId = data.share_id;
  return data.share_id;
}

async function saveComparison(btn){
  if(STATE.input?.demo){ crToast('데모 모드에선 저장이 안 돼요'); return; }
  if(STATE.input?.share){ crToast('공유받은 결과는 직접 비교해보세요'); return; }
  if(STATE.savedShareId){ location.href='/mypage.html?tab=savedcmp'; return; } // 이미 저장됨 → 저장 화면으로
  if(!STATE.compared?.length){ crToast('저장할 결과가 없어요'); return; }
  if(btn){ btn.disabled=true; btn.style.opacity='.6'; }
  try{
    const sid = await ensureSaved();
    if(sid){
      crToast('마이페이지에 저장했어요');
      if(btn){
        btn.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>저장 화면으로 가기';
        btn.style.width='auto'; btn.style.padding='0 18px';
        btn.onclick=function(){ location.href='/mypage.html?tab=savedcmp'; };
      }
    }
  }catch(e){ console.error(e); crToast('저장 중 오류가 났어요'); }
  finally{ if(btn){ btn.disabled=false; btn.style.opacity='1'; } }
}

// 공유: 스냅샷 저장 후 share_id 링크 생성 → 모바일 공유시트 / PC 링크 복사
async function shareComparison(btn){
  if(STATE.input?.demo){ crToast('데모 모드에선 공유가 안 돼요'); return; }
  if(STATE.input?.share){ crToast('공유받은 결과예요 — 직접 비교해보세요'); return; }
  if(!STATE.compared?.length){ crToast('공유할 결과가 없어요'); return; }
  if(btn){ btn.disabled=true; btn.style.opacity='.6'; }
  try{
    const sid = await ensureSaved();
    if(!sid) return; // 로그인 페이지로 이동됨
    const url = location.origin + '/compare-result-v2.html?share=' + encodeURIComponent(sid);
    const title = STATE.type?.type_name_kr || '나의 취향 비교 결과';
    if(navigator.share){
      try{ await navigator.share({ title:'YLLOWTAP 취향 비교', text:title, url }); }
      catch(e){ /* 사용자가 공유 취소 — 무시 */ }
    } else if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(url);
      crToast('공유 링크를 복사했어요');
    } else {
      prompt('아래 링크를 복사해서 공유하세요', url);
    }
  }catch(e){ console.error(e); crToast('공유 중 오류가 났어요'); }
  finally{ if(btn){ btn.disabled=false; btn.style.opacity='1'; } }
}

/* ---------- 11. 찜 ---------- */
async function currentUser(){ try{ const {data:{user}}=await sb.auth.getUser(); return user; }catch(e){ return null; } }
async function markWishlisted(){
  const user=await currentUser(); if(!user)return;
  try{ const {data}=await sb.from('wishlists').select('product_id').eq('user_id',user.id);
    const set=new Set((data||[]).map(w=>String(w.product_id)));
    document.querySelectorAll('[data-wish]').forEach(b=>{ if(set.has(String(b.getAttribute('data-wish'))))b.classList.add('on'); });
  }catch(e){}
}
async function toggleWish(btn){
  const user=await currentUser(); if(!user){ alert('찜은 로그인 후 이용할 수 있어요.'); return; }
  const pid=btn.getAttribute('data-wish'), on=btn.classList.contains('on');
  try{ if(on){ await sb.from('wishlists').delete().eq('user_id',user.id).eq('product_id',pid); btn.classList.remove('on'); }
    else{ await sb.from('wishlists').insert({user_id:user.id,product_id:pid}); btn.classList.add('on'); } }
  catch(e){ console.error(e); }
}

/* ---------- 12. 시작 ---------- */
function showEmpty(){ $app.innerHTML=`<div class="cr-empty"><h2>비교 정보가 없어요</h2><p>다시 비교를 진행하면 결과를 보여드릴게요.</p><a href="${ROUTE.back}">비교하러 가기</a></div>`; }
(async function init(){
  const url = new URLSearchParams(location.search);
  const shareId = url.get('share');
  let input;
  if(shareId){
    // 공유 링크로 들어온 사람 — 로그인 없이 snapshot만 받아서 그대로 렌더
    try{
      const { data:snap, error } = await sb.rpc('get_shared_comparison', { p_share_id: shareId });
      if(error || !snap){ showEmpty(); return; }
      input = {
        quality: snap.quality, mood: snap.mood,
        products: (snap.products||[]).map(p=>String(p.id)),
        selected: snap.selectedId ? String(snap.selectedId) : null,
        category: snap.category || null, demo:false, share:true
      };
    }catch(e){ console.error(e); showEmpty(); return; }
  } else {
    input = readInput(); if(!input){ showEmpty(); return; }
    // 회원 전용: 데모(?demo=1)는 예외, 그 외엔 로그인 안 했으면 로그인 페이지로
    if(!input.demo){
      const loginUrl = '/login.html?redirect=' + encodeURIComponent(location.pathname + location.search);
      try{
        const { data:{ session } } = await sb.auth.getSession();
        if(!session){ location.href=loginUrl; return; }
      }catch(e){ location.href=loginUrl; return; }
    }
  }
  try{
    const data=await loadData(input);
    if(!data.compared.length){ showEmpty(); return; }
    const type=pickTasteType(input.quality,input.mood,data.profiles);
    // 기본 선택 = 비교 상품 중 가장 잘 맞는(매칭% 1순위) 상품 → "더 가까운 상품" 문구와 일치
    let defaultSel = data.compared.length ? String(data.compared[0].id) : null;
    if(data.compared.length){
      const best = data.compared
        .map(p=>({id:String(p.id), m:matchPercent(input.quality,input.mood,scoreOf(data.scoreMap,p.id))}))
        .sort((a,b)=>b.m-a.m)[0];
      if(best) defaultSel = best.id;
    }
    // 공유 보기일 땐 공유한 사람이 고른 상품을 기본 선택으로
    if(input.share && input.selected) defaultSel = String(input.selected);
    STATE={ input, ...data, type, selectedId: defaultSel };
    render();
  }catch(e){ console.error(e); showEmpty(); }
})();