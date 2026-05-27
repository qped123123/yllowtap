/* =====================================================
   YLLOWTAP — Common Header Script
   모든 페이지에서 로드: 장바구니 개수 + 로그인 상태
   ===================================================== */

(async function(){
  // Supabase 체크
  if(typeof sb==='undefined') return;

  try{
    const{data:{session}}=await sb.auth.getSession();

    // 1. 로그인 상태면 LOGIN → MY PAGE 변경
    if(session){
      document.querySelectorAll('.header__actions a, .mobile-menu a').forEach(a=>{
        if(a.textContent.trim()==='Login'){
          a.textContent='My Page';
          a.href='/mypage.html';
        }
      });
    }

    // 2. 장바구니 개수 로드
    let count=0;

    if(session){
      // 회원: user_id로 카트 찾기
      const{data:cart}=await sb.from('carts').select('id').eq('user_id',session.user.id).single();
      if(cart){
        const{data:items}=await sb.from('cart_items').select('id').eq('cart_id',cart.id);
        count=items?.length||0;
      }
    }else{
      // 비회원: guest_id로 카트 찾기
      const gid=localStorage.getItem('yllowtap_guest_id');
      if(gid){
        const{data:cart}=await sb.from('carts').select('id').eq('guest_id',gid).single();
        if(cart){
          const{data:items}=await sb.from('cart_items').select('id').eq('cart_id',cart.id);
          count=items?.length||0;
        }
      }
    }

    // 3. 헤더 BAG 개수 업데이트
    document.querySelectorAll('.header__actions a, .mobile-menu a').forEach(a=>{
      if(a.textContent.includes('Bag')||a.textContent.includes('BAG')){
        a.textContent='Bag ('+count+')';
      }
    });

  }catch(e){}
})();
