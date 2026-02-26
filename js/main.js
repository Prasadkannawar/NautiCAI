/* ═══════════════════════════════════════════════
   NautiCAI — Main JavaScript
   Navigation, Animations, Scroll Effects
═══════════════════════════════════════════════ */

/* ── Navbar scroll effect ────────────────────── */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (window.scrollY > 40) navbar.classList.add('scrolled');
  else navbar.classList.remove('scrolled');
  updateActiveNav();
}, { passive: true });

/* ── Active nav link on scroll ──────────────── */
function updateActiveNav() {
  const sections = document.querySelectorAll('section[id]');
  const scrollPos = window.scrollY + 120;
  sections.forEach(section => {
    const top = section.offsetTop;
    const height = section.offsetHeight;
    const navLink = document.querySelector(`.nav-link[href="#${section.id}"]`);
    if (navLink) {
      if (scrollPos >= top && scrollPos < top + height) navLink.classList.add('active');
      else navLink.classList.remove('active');
    }
  });
}

/* ── Hamburger menu ──────────────────────────── */
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('nav-links');
hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  const spans = hamburger.querySelectorAll('span');
  if (navLinks.classList.contains('open')) {
    spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
    spans[1].style.opacity = '0';
    spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
  } else {
    spans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
  }
});
navLinks.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    hamburger.querySelectorAll('span').forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
  });
});

/* ── AOS-like scroll animations ──────────────── */
const observerOptions = { threshold: 0.12, rootMargin: '0px 0px -40px 0px' };
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const delay = entry.target.getAttribute('data-delay') || 0;
      setTimeout(() => entry.target.classList.add('aos-animate'), parseInt(delay));
    }
  });
}, observerOptions);
document.querySelectorAll('[data-aos]').forEach(el => observer.observe(el));

/* ── Particle system ─────────────────────────── */
(function spawnParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  function createParticle() {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.bottom = '-4px';
    const duration = 8 + Math.random() * 12;
    p.style.animationDuration = duration + 's';
    p.style.animationDelay = Math.random() * 5 + 's';
    p.style.width = p.style.height = (1 + Math.random() * 2) + 'px';
    p.style.opacity = (0.2 + Math.random() * 0.4).toString();
    container.appendChild(p);
    setTimeout(() => p.remove(), (duration + 5) * 1000);
  }
  for (let i = 0; i < 20; i++) createParticle();
  setInterval(createParticle, 800);
})();

/* ── Smooth scroll for all anchor links ─────── */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

/* ── Upload type selection ───────────────────── */
window.setUploadType = function(type) {
  document.getElementById('btn-image').classList.toggle('active', type === 'image');
  document.getElementById('btn-video').classList.toggle('active', type === 'video');
  const input = document.getElementById('file-input');
  input.accept = type === 'image' ? 'image/*' : 'video/*';
};

/* ── Logo upload placeholder ─────────────────── */
// Allows user to click the logo to upload their own
document.getElementById('nav-logo-link').addEventListener('click', function(e) {
  // Only intercept if not navigating
}, false);

/* ── Counter animation for stats ─────────────── */
function animateCounter(el, target, suffix = '') {
  let current = 0;
  const duration = 1800;
  const step = target / (duration / 16);
  const timer = setInterval(() => {
    current += step;
    if (current >= target) {
      current = target;
      clearInterval(timer);
    }
    el.textContent = (Number.isInteger(target) ? Math.floor(current) : current.toFixed(1)) + suffix;
  }, 16);
}

const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      statsObserver.unobserve(entry.target);
      entry.target.querySelectorAll('.stat-value').forEach(el => {
        const text = el.textContent;
        const match = text.match(/([\d.]+)(.*)/);
        if (match) {
          const val = parseFloat(match[1]);
          const suffix = match[2] || '';
          const numEl = document.createElement('span');
          numEl.style.cssText = el.querySelector('span') ? '' : 'color:inherit';
          el.innerHTML = '<span id="counter-' + Math.random().toString(36).slice(2) + '">' + match[1] + '</span>';
          const counterEl = el.querySelector('span:first-child') || el;
          animateCounter(counterEl, val, '');
          // Restore suffix span
          const suffixSpan = document.createElement('span');
          suffixSpan.textContent = suffix;
          el.appendChild(suffixSpan);
        }
      });
    }
  });
}, { threshold: 0.5 });
const heroStats = document.querySelector('.hero-stats');
if (heroStats) statsObserver.observe(heroStats);
