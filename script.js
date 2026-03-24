// ── Language Toggle ──
let currentLang = 'tr';

function toggleLang() {
  currentLang = currentLang === 'en' ? 'tr' : 'en';
  document.getElementById('langToggle').textContent = currentLang === 'tr' ? 'EN' : 'TR';
  document.documentElement.lang = currentLang;
  applyLang();
}

function applyLang() {
  const attr = `data-${currentLang}`;
  document.querySelectorAll(`[${attr}]`).forEach(el => {
    el.textContent = el.getAttribute(attr);
  });
  // placeholders
  document.querySelectorAll('[data-en-placeholder]').forEach(el => {
    const key = currentLang === 'en' ? 'data-en-placeholder' : 'data-tr-placeholder';
    if (el.getAttribute(key)) el.placeholder = el.getAttribute(key);
  });
  // select options
  document.querySelectorAll('select option[data-en]').forEach(opt => {
    opt.textContent = opt.getAttribute(attr) || opt.textContent;
  });
}

// Apply Turkish on load
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('langToggle').textContent = 'EN';
  applyLang();
});

// ── Navbar scroll ──
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  nav.classList.toggle('scrolled', window.scrollY > 20);
});

// ── Mobile menu ──
function toggleMenu() {
  document.getElementById('navLinks').classList.toggle('open');
}

// Close mobile menu on link click
document.querySelectorAll('.nav-links a').forEach(a => {
  a.addEventListener('click', () => {
    document.getElementById('navLinks').classList.remove('open');
  });
});

// ── Contact form ──
function handleSubmit(e) {
  e.preventDefault();

  const name    = document.getElementById('fieldName').value.trim();
  const company = document.getElementById('fieldCompany').value.trim();
  const email   = document.getElementById('fieldEmail').value.trim();
  const service = document.getElementById('fieldService').value;
  const message = document.getElementById('fieldMessage').value.trim();

  const subject = encodeURIComponent(`LunaSoft İletişim: ${service || 'Genel'} - ${name}`);
  const body = encodeURIComponent(
    `Ad Soyad: ${name}\n` +
    `Şirket: ${company || '-'}\n` +
    `E-posta: ${email}\n` +
    `Hizmet: ${service || '-'}\n\n` +
    `Mesaj:\n${message}`
  );

  window.location.href = `mailto:info@lunasoft.com.tr?subject=${subject}&body=${body}`;

  const success = document.getElementById('formSuccess');
  success.classList.add('visible');
  e.target.reset();
  setTimeout(() => success.classList.remove('visible'), 5000);
}

// ── Scroll animations ──
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.service-card, .why-feature, .contact-form').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  observer.observe(el);
});
