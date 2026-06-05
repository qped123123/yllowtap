/* =====================================================
   COMMON HEADER — 로그인 상태, 검색, SNS 아이콘
   모든 페이지에서 <script src="./js/common-header.js"></script> 로 로드
   ===================================================== */

(function () {
  // ── Supabase 클라이언트 (이미 페이지에 sb가 있으면 재사용) ──
  let sbClient = null;

  function getSb() {
    if (sbClient) return sbClient;
    // 페이지에서 이미 만든 sb 변수 사용
    if (typeof window.sb !== 'undefined') { sbClient = window.sb; return sbClient; }
    if (typeof sb !== 'undefined') { sbClient = sb; return sbClient; }
    // 직접 생성 (페이지 스크립트에서 anon 키 자동 탐색)
    if (window.supabase) {
      var url = 'https://ppihvvpplqikclftrwdb.supabase.co';
      var key = window.SUPABASE_ANON || window._SUPABASE_ANON || '';
      if (!key) {
        var scripts = document.querySelectorAll('script');
        for (var i = 0; i < scripts.length; i++) {
          var txt = scripts[i].textContent || '';
          var m = txt.match(/SUPABASE_ANON\s*=\s*'([^']{20,})'/);
          if (m) { key = m[1]; break; }
        }
      }
      if (key) { sbClient = window.supabase.createClient(url, key); return sbClient; }
    }
    return null;
  }

  // ── 헤더 액션 영역 업데이트 ──
  async function updateHeaderAuth() {
    const supa = getSb();
    if (!supa) return;

    const { data: { user } } = await supa.auth.getUser();
    const actions = document.querySelector('.header__actions');
    const mobileMenu = document.querySelector('.mobile-menu');
    buildNav();
    if (!actions) return;

    // 햄버거 버튼 보존
    const hamburger = actions.querySelector('.header__hamburger');
    const HEART_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    const BAG_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';

    if (user) {
      // ── 로그인 상태 ──
      const displayName = user.user_metadata?.full_name
        || user.user_metadata?.name
        || user.email?.split('@')[0]
        || 'User';

      actions.innerHTML = '';

      // 검색 아이콘 (토글)
      const searchBtn = document.createElement('button');
      searchBtn.className = 'header__search-toggle';
      searchBtn.setAttribute('aria-label', '검색');
      searchBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      searchBtn.addEventListener('click', toggleSearch);
      actions.appendChild(searchBtn);

      // LOGOUT
      const logoutLink = document.createElement('a');
      logoutLink.href = '#';
      logoutLink.textContent = 'Logout';
      logoutLink.addEventListener('click', async (e) => {
        e.preventDefault();
        await getSb().auth.signOut();
        window.location.reload();
      });
      actions.appendChild(logoutLink);

      // ORDER
      const orderLink = document.createElement('a');
      orderLink.href = '/mypage.html?tab=orders';
      orderLink.textContent = 'Order';
      actions.appendChild(orderLink);

      // WISHLIST (♡)
      const wishLink = document.createElement('a');
      wishLink.href = '/mypage.html?tab=wishlist';
      wishLink.id = 'headerWishLink';
      wishLink.className = 'header__icon-link';
      wishLink.setAttribute('aria-label', 'Wishlist');
      wishLink.title = 'Wishlist';
      wishLink.innerHTML = HEART_SVG;
      actions.appendChild(wishLink);

      // BAG (장바구니 아이콘)
      const cartLink = document.createElement('a');
      cartLink.href = '/cart.html';
      cartLink.id = 'headerCartLink';
      cartLink.className = 'header__icon-link';
      cartLink.setAttribute('aria-label', 'Bag');
      cartLink.title = 'Bag';
      cartLink.innerHTML = BAG_SVG + '<span class="header__cart-badge">0</span>';
      actions.appendChild(cartLink);

      // MYPAGE
      const myLink = document.createElement('a');
      myLink.href = '/mypage.html';
      myLink.textContent = 'Mypage';
      actions.appendChild(myLink);

      // SNS 아이콘들
      appendSocialIcons(actions);

      // 햄버거 복원
      if (hamburger) actions.appendChild(hamburger);

      // 카트 수량 업데이트
      updateCartCount();

      // ── 모바일 메뉴 업데이트 ──
      if (mobileMenu) {
        // 기존 로그인/위시리스트 링크 제거 후 교체
        const existingLogin = mobileMenu.querySelector('a[href="/login.html"]');
        if (existingLogin) existingLogin.remove();

        // 하단에 로그인 상태 링크 추가 (중복 방지)
        if (!mobileMenu.querySelector('.mobile-auth-section')) {
          const authSection = document.createElement('div');
          authSection.className = 'mobile-auth-section';
          authSection.style.cssText = 'margin-top:20px;padding-top:20px;border-top:1px solid #E5E1DC;display:flex;flex-direction:column;align-items:center;gap:16px;';
          authSection.innerHTML = '\
            <span style="font-size:13px;color:#888;">' + displayName + '님</span>\
            <a href="/mypage.html" style="font-size:18px;">My Page</a>\
            <a href="/mypage.html?tab=orders" style="font-size:18px;">Orders</a>\
            <a href="/cart.html" style="font-size:18px;">Bag</a>\
            <a href="#" class="mobile-logout-btn" style="font-size:18px;color:#888;">Logout</a>\
          ';
          mobileMenu.appendChild(authSection);

          authSection.querySelector('.mobile-logout-btn').addEventListener('click', async (e) => {
            e.preventDefault();
            await getSb().auth.signOut();
            window.location.reload();
          });
        }
      }

    } else {
      // ── 비로그인 상태 ──
      actions.innerHTML = '';

      // 검색 아이콘
      const searchBtn = document.createElement('button');
      searchBtn.className = 'header__search-toggle';
      searchBtn.setAttribute('aria-label', '검색');
      searchBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      searchBtn.addEventListener('click', toggleSearch);
      actions.appendChild(searchBtn);

      const loginLink = document.createElement('a');
      loginLink.href = '/login.html';
      loginLink.textContent = 'Login';
      actions.appendChild(loginLink);

      const wishLink = document.createElement('a');
      wishLink.href = '/login.html';
      wishLink.id = 'headerWishLink';
      wishLink.className = 'header__icon-link';
      wishLink.setAttribute('aria-label', 'Wishlist');
      wishLink.title = 'Wishlist';
      wishLink.innerHTML = HEART_SVG;
      actions.appendChild(wishLink);

      const cartLink = document.createElement('a');
      cartLink.href = '/cart.html';
      cartLink.id = 'headerCartLink';
      cartLink.className = 'header__icon-link';
      cartLink.setAttribute('aria-label', 'Bag');
      cartLink.title = 'Bag';
      cartLink.innerHTML = BAG_SVG + '<span class="header__cart-badge">0</span>';
      actions.appendChild(cartLink);

      // SNS 아이콘들
      appendSocialIcons(actions);

      // 햄버거 복원
      if (hamburger) actions.appendChild(hamburger);

      // 비로그인(게스트)도 장바구니 수량 표시
      updateCartCount();
    }

    // 햄버거 이벤트 재바인딩
    bindHamburger();
  }

  // ── SNS 아이콘 추가 ──
  var NAV_ITEMS = [['Best','best'],['New In','new'],['Bags','bags'],['Jewelry','jewelry'],['Keyring','keyring'],['Sale','sale']];
  function navLinksHTML() { return NAV_ITEMS.map(function(it){ return '<a href="/category.html?cat=' + it[1] + '">' + it[0] + '</a>'; }).join(''); }
  function buildNav() {
    var nav = document.querySelector('.header__nav');
    if (nav) nav.innerHTML = navLinksHTML();
    var mm = document.querySelector('.mobile-menu');
    if (mm) {
      mm.querySelectorAll('a').forEach(function(a){ if (!a.closest('.mobile-auth-section')) a.remove(); });
      var auth = mm.querySelector('.mobile-auth-section');
      var temp = document.createElement('div'); temp.innerHTML = navLinksHTML();
      Array.prototype.slice.call(temp.children).forEach(function(l){ if (auth) mm.insertBefore(l, auth); else mm.appendChild(l); });
    }
  }

  function appendSocialIcons(container) {
    const socialWrap = document.createElement('div');
    socialWrap.className = 'header__social-icons';
    socialWrap.innerHTML = '\
      <a href="https://www.instagram.com/" target="_blank" rel="noopener" aria-label="Instagram" title="Instagram">\
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">\
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="5"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>\
        </svg>\
      </a>\
      <a href="https://www.youtube.com/" target="_blank" rel="noopener" aria-label="YouTube" title="YouTube">\
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">\
          <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.13C5.12 19.56 12 19.56 12 19.56s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z"/>\
          <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>\
        </svg>\
      </a>\
    ';
    container.appendChild(socialWrap);
  }

  // ── 검색바 토글 ──
  function toggleSearch() {
    var searchBar = document.querySelector('.header-search-bar');
    if (!searchBar) {
      searchBar = document.createElement('div');
      searchBar.className = 'header-search-bar';
      searchBar.innerHTML = '\
        <div class="header-search-bar__inner">\
          <input type="text" class="header-search-bar__input" placeholder="상품 검색..." autocomplete="off" id="headerSearchInput">\
          <button class="header-search-bar__btn" id="headerSearchBtn" aria-label="검색">\
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>\
          </button>\
          <button class="header-search-bar__close" id="headerSearchClose" aria-label="닫기">✕</button>\
        </div>\
      ';
      document.body.appendChild(searchBar);

      // 검색 실행
      var input = searchBar.querySelector('#headerSearchInput');
      var btn = searchBar.querySelector('#headerSearchBtn');
      var close = searchBar.querySelector('#headerSearchClose');

      btn.addEventListener('click', function() { doSearch(input.value); });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doSearch(input.value);
        if (e.key === 'Escape') closeSearch();
      });
      close.addEventListener('click', closeSearch);
    }

    searchBar.classList.toggle('active');
    if (searchBar.classList.contains('active')) {
      setTimeout(function() { searchBar.querySelector('#headerSearchInput').focus(); }, 100);
    }
  }

  function closeSearch() {
    var bar = document.querySelector('.header-search-bar');
    if (bar) bar.classList.remove('active');
  }

  function doSearch(query) {
    query = query.trim();
    if (!query) return;
    window.location.href = '/category.html?search=' + encodeURIComponent(query);
  }

  // ── 카트 수량 업데이트 (로그인 + 비로그인 게스트 모두) ──
  function setBag(link, n) {
    var b = link.querySelector('.header__cart-badge');
    if (b) { b.textContent = n; } else { link.textContent = 'Bag (' + n + ')'; }
  }
  async function updateCartCount() {
    try {
      var supa = getSb(); if (!supa) return;
      var result = await supa.auth.getUser();
      var user = result.data.user;
      var cartId = null;

      if (user) {
        var cartsResult = await supa.from('carts').select('id').eq('user_id', user.id);
        if (cartsResult.data && cartsResult.data.length) cartId = cartsResult.data[0].id;
      } else {
        var gid = localStorage.getItem('yllowtap_guest_id');
        if (gid) {
          var gc = await supa.from('carts').select('id').eq('guest_id', gid);
          if (gc.data && gc.data.length) cartId = gc.data[0].id;
        }
      }

      var cartLink = document.getElementById('headerCartLink');
      if (!cartLink) return;
      if (!cartId) { setBag(cartLink, 0); return; }

      var countResult = await supa.from('cart_items').select('*', { count: 'exact', head: true }).eq('cart_id', cartId);
      var count = countResult.count || 0;
      setBag(cartLink, count);
    } catch (e) {}
  }
  // 다른 페이지 스크립트(예: product.html addToCart)에서 담은 직후 부를 수 있게 노출
  window.refreshCartCount = updateCartCount;

  // ── 햄버거 메뉴 바인딩 ──
  function bindHamburger() {
    var hamburger = document.querySelector('.header__hamburger');
    var mobileMenu = document.querySelector('.mobile-menu');
    var closeBtn = mobileMenu ? mobileMenu.querySelector('.mobile-menu__close') : null;

    if (hamburger && mobileMenu) {
      // 기존 리스너 제거를 위해 clone
      var newHamburger = hamburger.cloneNode(true);
      hamburger.parentNode.replaceChild(newHamburger, hamburger);

      newHamburger.addEventListener('click', function() {
        mobileMenu.classList.add('active');
        document.body.style.overflow = 'hidden';
      });
    }

    if (closeBtn && mobileMenu) {
      closeBtn.addEventListener('click', function() {
        mobileMenu.classList.remove('active');
        document.body.style.overflow = '';
      });
    }

    // 모바일 메뉴 링크 클릭 시 닫기
    if (mobileMenu) {
      mobileMenu.querySelectorAll('a').forEach(function(a) {
        a.addEventListener('click', function() {
          mobileMenu.classList.remove('active');
          document.body.style.overflow = '';
        });
      });
    }
  }

  // ── 검색바 + SNS 아이콘 스타일 주입 ──
  function injectStyles() {
    if (document.getElementById('common-header-styles')) return;
    var style = document.createElement('style');
    style.id = 'common-header-styles';
    style.textContent = '\
      .header__search-toggle {\
        display:flex; align-items:center; justify-content:center;\
        padding:4px; color:var(--text-primary,#111);\
        cursor:pointer; background:none; border:none;\
        transition:opacity .3s;\
      }\
      .header__search-toggle:hover { opacity:.5; }\
      .header__actions { gap:12px; }\
      .header__social-icons {\
        display:flex; align-items:center; gap:12px; margin-left:0;\
      }\
      .header__social-icons a {\
        display:flex; align-items:center; justify-content:center;\
        color:var(--text-primary,#111); transition:opacity .3s;\
      }\
      .header__social-icons a:hover { opacity:.5; }\
      .header-search-bar {\
        position:fixed; top:var(--header-height,88px); left:0; right:0;\
        z-index:998; background:var(--bg-main,#F7F5F2);\
        border-bottom:1px solid var(--divider,#D8D3CB);\
        max-height:0; overflow:hidden; opacity:0;\
        transition:max-height .35s ease, opacity .3s ease;\
      }\
      .header-search-bar.active {\
        max-height:80px; opacity:1;\
      }\
      .header-search-bar__inner {\
        display:flex; align-items:center; gap:12px;\
        max-width:600px; margin:0 auto; padding:16px 20px;\
      }\
      .header-search-bar__input {\
        flex:1; height:40px; padding:0 16px;\
        font-size:14px; font-family:inherit;\
        background:#fff; border:1px solid var(--divider,#D8D3CB);\
        outline:none; color:var(--text-primary,#111);\
        transition:border-color .3s;\
      }\
      .header-search-bar__input:focus {\
        border-color:var(--text-primary,#111);\
      }\
      .header-search-bar__input::placeholder {\
        color:var(--text-muted,#888);\
      }\
      .header-search-bar__btn {\
        display:flex; align-items:center; justify-content:center;\
        width:40px; height:40px;\
        background:var(--text-primary,#111); color:#fff;\
        border:none; cursor:pointer; flex-shrink:0;\
        transition:opacity .3s;\
      }\
      .header-search-bar__btn:hover { opacity:.8; }\
      .header-search-bar__close {\
        font-size:18px; color:var(--text-muted,#888);\
        background:none; border:none; cursor:pointer; padding:4px;\
        transition:color .3s;\
      }\
      .header-search-bar__close:hover { color:var(--text-primary,#111); }\
      .header__icon-link { display:inline-flex; align-items:center; position:relative; color:inherit; }\
      .header__icon-link svg { width:18px; height:18px; }\
      .header__icon-link:hover svg { opacity:0.6; }\
      .header__cart-badge { position:absolute; top:-7px; right:-10px; min-width:15px; height:15px; padding:0 3px; border-radius:8px; background:#111; color:#fff; font-size:9px; line-height:15px; text-align:center; font-weight:600; box-sizing:border-box; }\
      a#headerCartLink { margin-right:12px; }\
      @media(max-width:1024px) { .header__actions { margin-left:auto; } }\
      @media(max-width:768px) {\
        .header__social-icons { display:none; }\
        .header__actions a { display:none; }\
        .header__actions a#headerCartLink, .header__actions a#headerWishLink { display:inline-flex; align-items:center; }\
        .header__search-toggle { display:flex; }\
        .header__actions .header__hamburger { display:flex; }\
        .header-search-bar__inner { padding:12px 16px; }\
      }\
      @media(max-width:1200px) {\
        .header__actions { gap:12px; }\
        .header__actions a { font-size:10px; letter-spacing:0.12em; }\
      }\
    ';
    document.head.appendChild(style);
  }

  // ── GA4 + Clarity 자동 삽입 ──
  function injectAnalytics() {
    if (document.getElementById('ga4-script')) return;
    // GA4
    var gaScript = document.createElement('script');
    gaScript.id = 'ga4-script';
    gaScript.async = true;
    gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-4EJX3DZ6TB';
    document.head.appendChild(gaScript);
    var gaInit = document.createElement('script');
    gaInit.textContent = "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-4EJX3DZ6TB');";
    document.head.appendChild(gaInit);
    // Clarity
    var clarityScript = document.createElement('script');
    clarityScript.textContent = "(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,'clarity','script','wxzzmt0znb');";
    document.head.appendChild(clarityScript);
  }

  // ── 초기화 ──
  function init() {
    injectStyles();
    injectAnalytics();
    var retries = 0;
    function tryInit() {
      if (getSb()) {
        updateHeaderAuth();
      } else if (retries < 20) {
        retries++;
        setTimeout(tryInit, 100);
      }
    }
    tryInit();
  }

  // Supabase SDK 로드 후 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 100); });
  } else {
    setTimeout(init, 100);
  }
})();


/* =====================================================
   ★ NAV 메뉴 정리 (드롭다운 제거 · 6개 메뉴)
   - 데스크탑 네비를 6개 메뉴로 통일 (클릭 시 카테고리 이동)
   - 모바일: Accessories / Seasonal 숨김
   - 하위(hover) 드롭다운 없음 → 세부선택은 category.html 사이드바에서
   ===================================================== */
(function () {
  var NAV_MENU = [
    { slug: 'best',    label: 'Best' },
    { slug: 'new',     label: 'New In' },
    { slug: 'bags',    label: 'Bags' },
    { slug: 'jewelry', label: 'Jewelry' },
    { slug: 'keyring', label: 'Keyring' },
    { slug: 'sale',    label: 'Sale' }
  ];
  var HIDE_ON_MOBILE = ['accessories', 'seasonal'];

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildDesktopNav() {
    var nav = document.querySelector('.header__nav');
    if (!nav || nav.getAttribute('data-nav-built') === '1') return;
    nav.innerHTML = NAV_MENU.map(function (m) {
      return '<a href="/category.html?cat=' + m.slug + '">' + escapeHtml(m.label) + '</a>';
    }).join('');
    nav.setAttribute('data-nav-built', '1');
  }

  function hideMobileExtra() {
    var mobile = document.querySelector('.mobile-menu');
    if (!mobile) return;
    HIDE_ON_MOBILE.forEach(function (slug) {
      var link = mobile.querySelector('a[href*="cat=' + slug + '"]');
      if (link) link.style.display = 'none';
    });
  }

  function initNav() {
    buildDesktopNav();
    hideMobileExtra();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();