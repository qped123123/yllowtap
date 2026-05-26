/* =====================================================
   YLLOWTAP — Main JavaScript
   ===================================================== */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Hero Slider ── */
  const slides = document.querySelectorAll('.hero__slide');
  const pagNums = document.querySelectorAll('.hero__pagination span');
  let current = 0;
  let autoSlideTimer;

  function goToSlide(index) {
    slides.forEach(s => s.classList.remove('active'));
    pagNums.forEach(p => p.classList.remove('active'));
    current = index;
    if (current >= slides.length) current = 0;
    if (current < 0) current = slides.length - 1;
    slides[current].classList.add('active');
    if (pagNums[current]) pagNums[current].classList.add('active');
  }

  function nextSlide() { goToSlide(current + 1); }

  function startAutoSlide() {
    autoSlideTimer = setInterval(nextSlide, 5000);
  }

  function resetAutoSlide() {
    clearInterval(autoSlideTimer);
    startAutoSlide();
  }

  // Pagination click
  pagNums.forEach((p, i) => {
    p.addEventListener('click', () => {
      goToSlide(i);
      resetAutoSlide();
    });
    p.style.cursor = 'pointer';
  });

  // Swipe support
  let touchStartX = 0;
  const heroEl = document.querySelector('.hero');
  if (heroEl) {
    heroEl.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    heroEl.addEventListener('touchend', (e) => {
      const diff = touchStartX - e.changedTouches[0].screenX;
      if (Math.abs(diff) > 50) {
        if (diff > 0) goToSlide(current + 1);
        else goToSlide(current - 1);
        resetAutoSlide();
      }
    }, { passive: true });
  }

  if (slides.length > 0) {
    goToSlide(0);
    startAutoSlide();
  }


  /* ── Mobile Menu ── */
  const hamburger = document.querySelector('.header__hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');
  const mobileClose = document.querySelector('.mobile-menu__close');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      mobileMenu.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  }

  if (mobileClose && mobileMenu) {
    mobileClose.addEventListener('click', () => {
      mobileMenu.classList.remove('active');
      document.body.style.overflow = '';
    });
  }

  // Close mobile menu on link click
  if (mobileMenu) {
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('active');
        document.body.style.overflow = '';
      });
    });
  }


  /* ── Header scroll blur ── */
  const header = document.querySelector('.header');
  if (header) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) {
        header.style.backdropFilter = 'blur(20px)';
        header.style.webkitBackdropFilter = 'blur(20px)';
      } else {
        header.style.backdropFilter = 'blur(12px)';
        header.style.webkitBackdropFilter = 'blur(12px)';
      }
    }, { passive: true });
  }


  /* ── Audio Toggle ── */
  const bgm = document.getElementById('heroBgm');
  const audioToggle = document.getElementById('audioToggleBtn');
  const audioOffIcon = document.getElementById('audioOffIcon');
  const audioOnIcon = document.getElementById('audioOnIcon');
  let audioPlaying = false;

  if (bgm && audioToggle) {
    bgm.volume = 0.3;

    audioToggle.addEventListener('click', () => {
      if (audioPlaying) {
        bgm.pause();
        audioOffIcon.style.display = '';
        audioOnIcon.style.display = 'none';
      } else {
        bgm.play().catch(() => {});
        audioOffIcon.style.display = 'none';
        audioOnIcon.style.display = '';
      }
      audioPlaying = !audioPlaying;
    });
  }


  /* ── Video Pause/Play ── */
  const videoPauseBtn = document.getElementById('videoPauseBtn');
  const videoPauseIcon = document.getElementById('videoPauseIcon');
  const videoPlayIcon = document.getElementById('videoPlayIcon');
  let videoPaused = false;

  if (videoPauseBtn) {
    videoPauseBtn.addEventListener('click', () => {
      const activeSlide = document.querySelector('.hero__slide.active');
      const video = activeSlide ? activeSlide.querySelector('video') : null;

      if (videoPaused) {
        // Resume auto slide
        startAutoSlide();
        videoPauseIcon.style.display = '';
        videoPlayIcon.style.display = 'none';
        if (video) video.play();
      } else {
        // Pause auto slide
        clearInterval(autoSlideTimer);
        videoPauseIcon.style.display = 'none';
        videoPlayIcon.style.display = '';
        if (video) video.pause();
      }
      videoPaused = !videoPaused;
    });
  }

});