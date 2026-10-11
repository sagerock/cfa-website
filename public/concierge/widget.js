/* CfA site concierge widget: Jax, CfA's AI Assistant (Registrations & Payments).
   One self-contained script, no framework. Embed anywhere with
     <script src="https://learn.centerforanthroposophy.org/concierge/widget.js" defer></script>
   Optional attributes on the script tag:
     data-concierge-test   tag sessions from this page as test traffic
     data-open             open the panel on load
   The transcript lives on the server; the browser keeps only the session id. */
(function () {
  'use strict';
  if (window.__cfaConcierge) return;
  window.__cfaConcierge = true;

  var ENDPOINT = 'https://ckloewflialohuvixmvd.supabase.co/functions/v1/cfa-concierge';
  var TRACK = 'https://ckloewflialohuvixmvd.supabase.co/functions/v1/cfa-track';
  var SKEY = 'cfa_concierge_session';
  var script = document.currentScript || document.querySelector('script[src*="concierge/widget.js"]');
  var isTest = !!(script && script.hasAttribute('data-concierge-test'));
  var openOnLoad = !!(script && script.hasAttribute('data-open'));
  var GREETING = "Hi, I'm Jax, CfA's AI assistant. I can help you pick a program, get registered, or find your Zoom or sign-in link. What brings you here today?";
  var MAX_CHARS = 4000;

  function track(event, meta) {
    try {
      if (window.__cfaTrack) { window.__cfaTrack(event, meta || {}); return; }
      var payload = JSON.stringify({ event: event, path: location.pathname, referrer: document.referrer || '', session_id: '', meta: meta || {} });
      if (navigator.sendBeacon) navigator.sendBeacon(TRACK, new Blob([payload], { type: 'application/json' }));
    } catch (e) {}
  }

  var css = [
    '.cfa-cc{--cc-paper:#efeee6;--cc-raised:#f7f6f0;--cc-ink:#232a24;--cc-soft:#5a6055;--cc-line:#d9d8cd;--cc-green:#2e5e4e;--cc-on-green:#fff;--cc-chalk:rgba(46,94,78,.09);',
    'font-family:"Avenir Next",Avenir,"Segoe UI",system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.45;color:var(--cc-ink);}',
    '@media (prefers-color-scheme:dark){.cfa-cc{--cc-paper:#191f1a;--cc-raised:#222a23;--cc-ink:#e9e7da;--cc-soft:#a6ab9c;--cc-line:#38423a;--cc-green:#7fc0a3;--cc-on-green:#13201a;--cc-chalk:rgba(127,192,163,.1);}}',
    '.cfa-cc *{box-sizing:border-box;}',
    '.cfa-cc-launch{position:fixed;right:20px;bottom:20px;z-index:2147483000;border:0;border-radius:999px;padding:12px 18px;background:var(--cc-green);color:var(--cc-on-green);font:inherit;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.18);}',
    '.cfa-cc-launch:focus-visible,.cfa-cc button:focus-visible,.cfa-cc a:focus-visible,.cfa-cc textarea:focus-visible{outline:3px solid #b07e22;outline-offset:2px;}',
    '.cfa-cc-panel{position:fixed;right:20px;bottom:20px;z-index:2147483001;width:min(400px,calc(100vw - 24px));height:min(620px,calc(100vh - 40px));display:flex;flex-direction:column;background:var(--cc-paper);border:1px solid var(--cc-line);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;}',
    '.cfa-cc-panel[hidden]{display:none;}',
    '@media (max-width:480px){.cfa-cc-panel{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0;}}',
    '.cfa-cc-head{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:var(--cc-raised);border-bottom:1px solid var(--cc-line);}',
    '.cfa-cc-title{flex:1;margin:0;font-size:15px;font-weight:600;}',
    '.cfa-cc-sub{display:block;font-size:12.5px;font-weight:400;color:var(--cc-soft);}',
    '.cfa-cc-close{border:0;background:transparent;color:var(--cc-ink);font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;}',
    '.cfa-cc-person{display:block;padding:6px 14px;font-size:12.5px;color:var(--cc-soft);border-bottom:1px solid var(--cc-line);}',
    '.cfa-cc-person a{color:var(--cc-green);}',
    '.cfa-cc-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;}',
    '.cfa-cc-msg{max-width:88%;padding:9px 12px;border-radius:10px;white-space:pre-wrap;word-wrap:break-word;}',
    '.cfa-cc-msg a{color:var(--cc-green);}',
    '.cfa-cc-bot{align-self:flex-start;background:var(--cc-raised);border:1px solid var(--cc-line);}',
    '.cfa-cc-me{align-self:flex-end;background:var(--cc-chalk);}',
    '.cfa-cc-note{align-self:center;font-size:12.5px;color:var(--cc-soft);}',
    '.cfa-cc-card{align-self:flex-start;max-width:88%;padding:12px;border:1px solid var(--cc-green);border-radius:10px;background:var(--cc-raised);}',
    '.cfa-cc-card strong{display:block;margin-bottom:4px;}',
    '.cfa-cc-card span{display:block;font-size:13px;color:var(--cc-soft);margin-bottom:8px;}',
    '.cfa-cc-card a{display:inline-block;padding:8px 14px;border-radius:6px;background:var(--cc-green);color:var(--cc-on-green);text-decoration:none;font-weight:600;}',
    '.cfa-cc-form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--cc-line);background:var(--cc-raised);}',
    '.cfa-cc-form textarea{flex:1;resize:none;min-height:42px;max-height:120px;padding:9px 10px;border:1px solid var(--cc-line);border-radius:8px;background:var(--cc-paper);color:var(--cc-ink);font:inherit;}',
    '.cfa-cc-send{border:0;border-radius:8px;padding:0 14px;background:var(--cc-green);color:var(--cc-on-green);font:inherit;font-weight:600;cursor:pointer;}',
    '.cfa-cc-send:disabled{opacity:.5;cursor:default;}',
    '.cfa-cc-foot{padding:0 12px 8px;font-size:11.5px;color:var(--cc-soft);background:var(--cc-raised);}',
    '.cfa-cc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}',
  ].join('');

  var root = document.createElement('div');
  root.className = 'cfa-cc';
  var style = document.createElement('style');
  style.textContent = css;
  root.appendChild(style);

  var launch = document.createElement('button');
  launch.type = 'button';
  launch.className = 'cfa-cc-launch';
  launch.setAttribute('aria-haspopup', 'dialog');
  launch.textContent = 'Ask Jax';
  root.appendChild(launch);

  var panel = document.createElement('div');
  panel.className = 'cfa-cc-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'cfa-cc-title');
  panel.innerHTML =
    '<div class="cfa-cc-head"><h2 class="cfa-cc-title" id="cfa-cc-title">Jax, CfA’s AI Assistant<span class="cfa-cc-sub">Registrations &amp; Payments</span></h2>' +
    '<button type="button" class="cfa-cc-close" aria-label="Close chat">×</button></div>' +
    '<span class="cfa-cc-person">Talk to a person: <a href="mailto:jax@centerforanthroposophy.org,office@centerforanthroposophy.org">email us</a> or call <a href="tel:+16036542566">603-654-2566</a></span>' +
    '<div class="cfa-cc-log" role="log" aria-live="polite" aria-relevant="additions" tabindex="0"></div>' +
    '<form class="cfa-cc-form"><label class="cfa-cc-sr" for="cfa-cc-input">Message Jax</label>' +
    '<textarea id="cfa-cc-input" rows="1" maxlength="' + MAX_CHARS + '" placeholder="Type your question"></textarea>' +
    '<button type="submit" class="cfa-cc-send">Send</button></form>' +
    '<div class="cfa-cc-foot">Jax is an AI and can make mistakes. Don’t share card numbers or passwords here.</div>';
  root.appendChild(panel);

  var log = panel.querySelector('.cfa-cc-log');
  var form = panel.querySelector('form');
  var input = panel.querySelector('textarea');
  var send = panel.querySelector('.cfa-cc-send');
  var closeBtn = panel.querySelector('.cfa-cc-close');
  var busy = false;
  var greeted = false;

  function sessionId() { try { return sessionStorage.getItem(SKEY) || ''; } catch (e) { return ''; } }
  function setSessionId(id) { try { sessionStorage.setItem(SKEY, id); } catch (e) {} }

  // Plain text with links made clickable; markdown links and bold are honoured, nothing else.
  function render(el, raw) {
    el.textContent = '';
    var pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])|\*\*([^*]+)\*\*|(mailto:)?([\w.+-]+@[\w-]+\.[\w.-]*\w)/g;
    var last = 0, m;
    while ((m = pattern.exec(raw))) {
      if (m.index > last) el.appendChild(document.createTextNode(raw.slice(last, m.index)));
      if (m[4]) {
        var b = document.createElement('strong'); b.textContent = m[4]; el.appendChild(b);
      } else {
        var a = document.createElement('a');
        if (m[6]) { a.href = 'mailto:' + m[6]; a.textContent = m[6]; }
        else { a.href = m[2] || m[3]; a.textContent = m[1] || m[3]; a.target = '_blank'; a.rel = 'noopener'; }
        el.appendChild(a);
      }
      last = pattern.lastIndex;
    }
    if (last < raw.length) el.appendChild(document.createTextNode(raw.slice(last)));
  }

  function bubble(kind, textValue) {
    var el = document.createElement('div');
    el.className = 'cfa-cc-msg ' + (kind === 'me' ? 'cfa-cc-me' : kind === 'note' ? 'cfa-cc-note' : 'cfa-cc-bot');
    if (kind === 'me') el.textContent = textValue; else render(el, textValue);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function linkCard(data) {
    var card = document.createElement('div');
    card.className = 'cfa-cc-card';
    var name = document.createElement('strong');
    name.textContent = data.name;
    card.appendChild(name);
    if (data.price_line) {
      var price = document.createElement('span');
      price.textContent = data.price_line;
      card.appendChild(price);
    }
    var a = document.createElement('a');
    a.href = data.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Continue to sign-up';
    a.addEventListener('click', function () { track('concierge_link_click', { kind: data.kind }); });
    card.appendChild(a);
    log.appendChild(card);
    log.scrollTop = log.scrollHeight;
    track('concierge_link', { kind: data.kind });
  }

  function openPanel() {
    panel.hidden = false;
    launch.hidden = true;
    if (!greeted) { greeted = true; bubble('bot', GREETING); track('concierge_open'); }
    input.focus();
  }
  function closePanel() {
    panel.hidden = true;
    launch.hidden = false;
    launch.focus();
  }

  launch.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  panel.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closePanel(); return; }
    if (e.key !== 'Tab') return;
    var focusable = panel.querySelectorAll('a[href],button:not([disabled]),textarea,[tabindex="0"]');
    if (!focusable.length) return;
    var first = focusable[0], lastEl = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit')); }
  });

  function finish() {
    busy = false;
    send.disabled = false;
    input.focus();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var message = (input.value || '').trim();
    if (!message || busy) return;
    busy = true;
    send.disabled = true;
    input.value = '';
    bubble('me', message);
    track('concierge_message');
    var reply = null, replyText = '';

    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 90000) : null;
    fetch(ENDPOINT, {
      method: 'POST',
      signal: controller ? controller.signal : undefined,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId(), message: message, page_path: location.pathname, test: isTest }),
    }).then(function (res) {
      var type = res.headers.get('content-type') || '';
      if (type.indexOf('text/event-stream') < 0) {
        return res.json().catch(function () { return {}; }).then(function (out) {
          if (out.session_id) setSessionId(out.session_id);
          bubble('bot', out.message || "Sorry, I'm having trouble right now. Please email jax@centerforanthroposophy.org and a person at CfA will help.");
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function handle(event, data) {
        if (event === 'session') setSessionId(data.session_id);
        else if (event === 'token') {
          replyText += data.text;
          if (!reply) { if (!replyText.trim()) return; reply = bubble('bot', ''); }
          render(reply, replyText.replace(/^\s+/, ''));
          log.scrollTop = log.scrollHeight;
        } else if (event === 'link') { reply = null; replyText = ''; linkCard(data); }
        else if (event === 'verify_prompt') track('concierge_verify');
        else if (event === 'handoff') track('concierge_handoff', { filed: !!data.filed });
        else if (event === 'error') bubble('bot', data.message);
      }
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          buffer += decoder.decode(chunk.value, { stream: true });
          var parts = buffer.split('\n\n');
          buffer = parts.pop();
          parts.forEach(function (part) {
            var event = 'message', data = '';
            part.split('\n').forEach(function (line) {
              if (line.indexOf('event: ') === 0) event = line.slice(7);
              else if (line.indexOf('data: ') === 0) data += line.slice(6);
            });
            try { handle(event, JSON.parse(data || '{}')); } catch (err) {}
          });
          return pump();
        });
      }
      return pump();
    }).catch(function () {
      bubble('bot', "Sorry, I couldn't reach the server. Please email jax@centerforanthroposophy.org and a person at CfA will help.");
    }).then(function () { if (timer) clearTimeout(timer); finish(); });
  });

  function mount() {
    document.body.appendChild(root);
    if (openOnLoad) openPanel();
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
