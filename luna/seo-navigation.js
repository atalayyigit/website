'use strict';
(function(){
 const select=document.getElementById('site-language');
 function withCampaign(href){const u=new URL(href,location.href);const q=new URLSearchParams(location.search);for(const [k,v] of q){if(k.startsWith('utm_')||['fbclid','brid','noredirect'].includes(k))u.searchParams.set(k,v);}return u.href;}
 if(select)select.addEventListener('change',()=>{const option=select.options[select.selectedIndex];if(option.dataset.url)location.assign(withCampaign(option.dataset.url));});
 document.querySelectorAll('[data-locale-link]').forEach(a=>{a.href=withCampaign(a.getAttribute('href'));});
 const menu=document.querySelector('.menu-toggle'),nav=document.getElementById('navigation');
 if(menu&&nav){menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));});nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false');}));}
 const year=document.getElementById('year');if(year)year.textContent=new Date().getFullYear();
})();
