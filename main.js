/* ─────────────────────────────────────────────
   HARUKAZ — Main JavaScript
   春風 · Matcha Meditation for Elevated Minds
   ───────────────────────────────────────────── */

'use strict';

// ── Nav Overlay ──────────────────────────────
const navToggle  = document.getElementById('nav-toggle');
const navOverlay = document.getElementById('nav-overlay');
const body       = document.body;

if (navToggle && navOverlay) {
  navToggle.addEventListener('click', () => {
    const isOpen = navOverlay.classList.toggle('open');
    navToggle.classList.toggle('active', isOpen);
    body.style.overflow = isOpen ? 'hidden' : '';
    navToggle.querySelector('.toggle-text').textContent = isOpen ? 'CLOSE' : 'MENU';
  });

  // Close on link click
  navOverlay.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navOverlay.classList.remove('open');
      navToggle.classList.remove('active');
      body.style.overflow = '';
      navToggle.querySelector('.toggle-text').textContent = 'MENU';
    });
  });

  // Close on ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && navOverlay.classList.contains('open')) {
      navOverlay.classList.remove('open');
      navToggle.classList.remove('active');
      body.style.overflow = '';
      navToggle.querySelector('.toggle-text').textContent = 'MENU';
    }
  });
}

// ── Scroll Reveal (Intersection Observer) ───
const reveals = document.querySelectorAll('.reveal');
if (reveals.length) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  reveals.forEach(el => observer.observe(el));
}

// ── Hero Particles (canvas) ──────────────────
const canvas = document.getElementById('hero-canvas');
if (canvas) {
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x = Math.random() * W;
      this.y = Math.random() * H;
      this.r = Math.random() * 1.5 + 0.3;
      this.speed = Math.random() * 0.3 + 0.05;
      this.angle = Math.random() * Math.PI * 2;
      this.alpha = Math.random() * 0.4 + 0.1;
      this.pulse = Math.random() * Math.PI * 2;
    }
    update() {
      this.x += Math.cos(this.angle) * this.speed;
      this.y += Math.sin(this.angle) * this.speed * 0.5 - 0.15;
      this.pulse += 0.02;
      this.alpha = (Math.sin(this.pulse) * 0.2 + 0.25);
      if (this.y < -5 || this.x < -5 || this.x > W + 5) this.reset();
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,169,110,${this.alpha})`;
      ctx.fill();
    }
  }

  function init() {
    resize();
    particles = Array.from({ length: 80 }, () => new Particle());
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', resize);
  init();
  loop();
}

// ── Parallax Hero ───────────────────────────
const heroSection = document.querySelector('.hero');
if (heroSection) {
  window.addEventListener('scroll', () => {
    const scrolled = window.scrollY;
    const bg = heroSection.querySelector('.hero__canvas');
    if (bg) bg.style.transform = `translateY(${scrolled * 0.3}px)`;
  }, { passive: true });
}

// ── Corporate Quiz ───────────────────────────
const quizForm   = document.getElementById('quiz-form');
const quizResult = document.getElementById('quiz-result');

if (quizForm) {
  quizForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const questions = quizForm.querySelectorAll('.quiz-question');
    let total = 0;
    let answered = 0;

    questions.forEach(q => {
      const checked = q.querySelector('input[type="radio"]:checked');
      if (checked) { total += parseInt(checked.value, 10); answered++; }
    });

    if (answered < questions.length) {
      alert('Please answer all questions to see your result.');
      return;
    }

    let message, tier;
    if (total <= 20) {
      message = 'Your team is running on empty. Intentional wellness is urgent.';
      tier = 'critical';
    } else if (total <= 30) {
      message = 'Your team has potential. A structured ritual practice could unlock it.';
      tier = 'moderate';
    } else {
      message = 'Your team is strong. HARUKAZ can help you sustain and deepen it.';
      tier = 'strong';
    }

    quizResult.querySelector('.quiz-result__score').textContent = total;
    quizResult.querySelector('.quiz-result__text').textContent = message;
    quizResult.classList.add('show');
    quizResult.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ── Book Form — Thank-You Overlay ────────────
const bookForm      = document.getElementById('book-form');
const thankYou      = document.getElementById('thankyou-overlay');
const serviceSelect = document.getElementById('service-select');
const groupSizeRow  = document.getElementById('group-size-row');

if (serviceSelect && groupSizeRow) {
  const soloServices = ['private', 'subscription', 'tasting', 'pairing'];
  serviceSelect.addEventListener('change', () => {
    const hide = soloServices.includes(serviceSelect.value);
    groupSizeRow.style.display = hide ? 'none' : '';
  });
}

if (bookForm && thankYou) {
  bookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    thankYou.classList.add('active');
    body.style.overflow = 'hidden';

    // Attempt Formspree submission (non-blocking)
    try {
      await fetch(bookForm.action, {
        method: 'POST',
        body: new FormData(bookForm),
        headers: { Accept: 'application/json' }
      });
    } catch (_) { /* silent — UX still proceeds */ }

    // After 8s, fade out overlay
    setTimeout(() => {
      thankYou.style.transition = 'opacity 1.5s ease';
      thankYou.style.opacity = '0';
      setTimeout(() => {
        thankYou.classList.remove('active');
        thankYou.style.opacity = '';
        body.style.overflow = '';
        bookForm.reset();
      }, 1500);
    }, 8000);
  });
}

// ── Flavor Bar Animations ────────────────────
const flavorBars = document.querySelectorAll('.flavor-bar__fill');
if (flavorBars.length) {
  const barObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        el.style.width = el.dataset.width;
        barObserver.unobserve(el);
      }
    });
  }, { threshold: 0.3 });

  flavorBars.forEach(bar => {
    const w = bar.style.width;
    bar.style.width = '0';
    bar.dataset.width = w;
    barObserver.observe(bar);
  });
}

// ── Nav scroll background ────────────────────
window.addEventListener('scroll', () => {
  const nav = document.getElementById('nav-persistent');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 80);
}, { passive: true });

// ── Hero video — hide placeholder when video loads ──
const heroVideo       = document.querySelector('.hero-video video');
const videoPlaceholder = document.getElementById('video-placeholder');
if (heroVideo && videoPlaceholder) {
  heroVideo.addEventListener('canplay', () => {
    videoPlaceholder.style.display = 'none';
    heroVideo.style.display = 'block';
  });
  if (heroVideo.readyState >= 3) {
    videoPlaceholder.style.display = 'none';
    heroVideo.style.display = 'block';
  } else {
    heroVideo.style.display = 'none';
  }
}
