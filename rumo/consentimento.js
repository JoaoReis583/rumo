/* Rumo — aviso de cookies e consentimento (LGPD).
 *
 * Regras que este arquivo cumpre:
 *  - nada além do essencial roda antes de a pessoa escolher (o Pixel da Meta só carrega com "sim");
 *  - "Aceitar todos" e "Rejeitar não essenciais" têm o mesmo destaque;
 *  - nada vem marcado por padrão;
 *  - dá para mudar a escolha depois (link "Preferências de cookies" no rodapé);
 *  - a escolha fica guardada com data e versão (prova do consentimento).
 *
 * Para incluir em uma página:  <script src="/consentimento.js" defer></script>
 * Para um link/botão abrir as preferências: adicione o atributo  data-cookie-prefs
 */
(function () {
  'use strict';

  var KEY = 'rumo_consent';
  var VERSION = 1;
  var PIXEL_ID = '2225822358818088';
  var pixelLoaded = false;

  function read() {
    try {
      var c = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (c && c.v === VERSION && typeof c.marketing === 'boolean') return c;
    } catch (e) { /* storage bloqueado: trata como "sem escolha" */ }
    return null;
  }
  function write(marketing) {
    var c = { v: VERSION, marketing: !!marketing, t: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* sem storage: vale só nesta página */ }
    return c;
  }

  // ---- Meta Pixel (só com consentimento de marketing) ----
  function loadPixel() {
    if (pixelLoaded || window.fbq) return;
    pixelLoaded = true;
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = true; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }
  function unloadPixel() {
    // Não dá para "descarregar" o script; avisa o Pixel para parar e recarrega na próxima visita sem ele.
    try { if (window.fbq) window.fbq('consent', 'revoke'); } catch (e) { }
    try { document.cookie.split(';').forEach(function (c) {
      var n = c.split('=')[0].trim();
      if (n === '_fbp' || n === '_fbc') {
        document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.' + location.hostname;
      }
    }); } catch (e) { }
  }

  function apply(c) {
    if (c && c.marketing) loadPixel(); else unloadPixel();
    try { window.dispatchEvent(new CustomEvent('rumo:consent', { detail: c })); } catch (e) { }
  }

  // ---- Interface ----
  var CSS = [
    '#rumoCk,#rumoCk *{box-sizing:border-box}',
    '#rumoCk{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;padding:12px;font:400 15px/1.5 "Instrument Sans",system-ui,sans-serif;color:#17382c}',
    '#rumoCk .ck-box{max-width:880px;margin:0 auto;background:#fff;border:2px solid #0f3d2e;border-radius:16px;padding:18px 20px;box-shadow:0 12px 40px -12px rgba(0,0,0,.35);max-height:calc(100vh - 24px);overflow:auto}',
    '#rumoCk h2{margin:0 0 6px;font:800 1.15rem "Bricolage Grotesque",system-ui,sans-serif;color:#0f3d2e}',
    '#rumoCk p{margin:0 0 10px;color:#17382c}',
    '#rumoCk a{color:#0f5c3a;text-decoration:underline;font-weight:600}',
    '#rumoCk .ck-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}',
    '#rumoCk button{font:600 .95rem "Instrument Sans",system-ui,sans-serif;border-radius:999px;padding:.65rem 1.2rem;cursor:pointer;min-height:44px;border:2px solid #0f3d2e;background:#0f3d2e;color:#fff}',
    '#rumoCk button.ck-alt{background:#fff;color:#0f3d2e}',
    '#rumoCk button:hover{background:#17604a;color:#fff}',
    '#rumoCk button:focus-visible,#rumoCk a:focus-visible,#rumoCk input:focus-visible{outline:3px solid #0f3d2e;outline-offset:2px;box-shadow:0 0 0 2px #fff}',
    '#rumoCk .ck-opt{display:flex;gap:12px;align-items:flex-start;border:1px solid #cfe5d8;border-radius:12px;padding:12px;margin-top:10px;background:#f4faf6}',
    '#rumoCk .ck-opt input{width:22px;height:22px;margin-top:2px;flex:none;accent-color:#0f3d2e}',
    '#rumoCk .ck-opt label{font-weight:700;color:#0f3d2e;display:block}',
    '#rumoCk .ck-opt small{display:block;color:#3f5a4d;font-size:.88rem;font-weight:400;margin-top:2px}',
    '@media (max-width:520px){#rumoCk .ck-row button{flex:1 1 100%}}'
  ].join('');

  var root = null;

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    if (html) n.innerHTML = html;
    return n;
  }

  function close(returnFocus) {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    if (returnFocus && returnFocus.focus) { try { returnFocus.focus(); } catch (e) { } }
  }

  function choose(marketing, returnFocus) {
    var c = write(marketing);
    close(returnFocus);
    apply(c);
  }

  function open(detailed, returnFocus) {
    if (root) close();
    if (!document.getElementById('rumoCkCss')) {
      var st = el('style', { id: 'rumoCkCss' }); st.textContent = CSS; document.head.appendChild(st);
    }
    var cur = read();
    root = el('div', { id: 'rumoCk', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'rumoCkT', 'aria-describedby': 'rumoCkD' });
    var box = el('div', { class: 'ck-box' });
    box.appendChild(el('h2', { id: 'rumoCkT' }, 'Sua privacidade no Rumo'));

    if (!detailed) {
      box.appendChild(el('p', { id: 'rumoCkD' },
        'Usamos o armazenamento essencial do navegador para o site funcionar (login, segurança e pagamento). ' +
        'Com a sua permissão, também usamos o Pixel da Meta para medir os anúncios do Rumo. ' +
        'Você escolhe e pode mudar quando quiser. <a href="/cookies">Política de Cookies</a>.'));
      var row = el('div', { class: 'ck-row' });
      var bAcc = el('button', { type: 'button' }, 'Aceitar todos');
      var bRej = el('button', { type: 'button' }, 'Rejeitar não essenciais');
      var bCus = el('button', { type: 'button', class: 'ck-alt' }, 'Personalizar');
      bAcc.onclick = function () { choose(true, returnFocus); };
      bRej.onclick = function () { choose(false, returnFocus); };
      bCus.onclick = function () { open(true, returnFocus); };
      row.appendChild(bAcc); row.appendChild(bRej); row.appendChild(bCus);
      box.appendChild(row);
    } else {
      box.appendChild(el('p', { id: 'rumoCkD' }, 'Escolha o que pode ser usado. Os essenciais não podem ser desligados porque, sem eles, o site não funciona.'));
      var o1 = el('div', { class: 'ck-opt' });
      o1.appendChild(el('input', { type: 'checkbox', id: 'rumoCkEss', checked: 'checked', disabled: 'disabled' }));
      var l1 = el('div'); l1.appendChild(el('label', { for: 'rumoCkEss' }, 'Essenciais (sempre ativos)'));
      l1.appendChild(el('small', {}, 'Manter você conectado, proteger contra abuso, processar o pagamento e guardar esta escolha.'));
      o1.appendChild(l1); box.appendChild(o1);
      var o2 = el('div', { class: 'ck-opt' });
      var cb = el('input', { type: 'checkbox', id: 'rumoCkMkt' }); cb.checked = !!(cur && cur.marketing);
      o2.appendChild(cb);
      var l2 = el('div'); l2.appendChild(el('label', { for: 'rumoCkMkt' }, 'Marketing e medição de anúncios (Meta Pixel)'));
      l2.appendChild(el('small', {}, 'Permite à Meta (Facebook/Instagram) saber que uma visita ou cadastro veio de um anúncio do Rumo. Desligado por padrão.'));
      o2.appendChild(l2); box.appendChild(o2);
      var row2 = el('div', { class: 'ck-row' });
      var bSave = el('button', { type: 'button' }, 'Salvar minhas escolhas');
      var bRej2 = el('button', { type: 'button' }, 'Rejeitar não essenciais');
      var bAcc2 = el('button', { type: 'button' }, 'Aceitar todos');
      bSave.onclick = function () { choose(cb.checked, returnFocus); };
      bRej2.onclick = function () { choose(false, returnFocus); };
      bAcc2.onclick = function () { choose(true, returnFocus); };
      row2.appendChild(bSave); row2.appendChild(bRej2); row2.appendChild(bAcc2);
      box.appendChild(row2);
      setTimeout(function () { try { cb.focus(); } catch (e) { } }, 0);
    }
    root.appendChild(box);
    document.body.insertBefore(root, document.body.firstChild);
  }

  // Qualquer elemento com data-cookie-prefs abre as preferências
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-cookie-prefs]') : null;
    if (!t) return;
    ev.preventDefault();
    open(true, t);
  });

  window.RumoConsent = {
    get: read,
    open: function () { open(true); },
    revokeMarketing: function () { var c = write(false); apply(c); return c; }
  };

  function start() {
    var c = read();
    if (c) apply(c); else open(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
