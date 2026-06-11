var EXT_MAP = {
  javascript: 'js', typescript: 'ts', python: 'py', rust: 'rs',
  go: 'go', java: 'java', cpp: 'cpp', 'c++': 'cpp', c: 'c',
  'c#': 'cs', html: 'html', css: 'css', json: 'json',
  yaml: 'yml', xml: 'xml', sql: 'sql', bash: 'sh', shell: 'sh',
  ruby: 'rb', php: 'php', swift: 'swift', kotlin: 'kt',
  scala: 'scala', markdown: 'md', plaintext: 'txt', text: 'txt',
};

function detectLanguage(pre) {
  var codeEl = pre.querySelector('code');
  if (codeEl && codeEl.className) {
    for (var _i = 0, _a = codeEl.className.split(' '); _i < _a.length; _i++) {
      var cls = _a[_i];
      var match_1 = cls.match(/language-(\w+)/) || cls.match(/lang-(\w+)/);
      if (match_1) return match_1[1].toLowerCase();
    }
  }
  var label = pre.querySelector(
    '.lang, .language-label, [class*="language"], [class*="lang-"], .code-language, [data-language]'
  );
  if (label) {
    return (label.textContent || label.getAttribute('data-language') || '').trim().toLowerCase();
  }
  var header = pre.closest('[class*="code"]') || pre.parentElement;
  if (header) {
    for (var _b = 0, _c = header.querySelectorAll('span, div, button'); _b < _c.length; _b++) {
      var el = _c[_b];
      var t = (el.textContent || '').trim().toLowerCase();
      if (t.length > 0 && t.length < 20 && EXT_MAP[t]) return t;
    }
  }
  return null;
}

function getFilename(pre) {
  var lang = detectLanguage(pre);
  if (lang && EXT_MAP[lang]) return 'code.' + EXT_MAP[lang];
  if (lang) return 'code.' + lang;
  return 'code.txt';
}

// ── Intent detection ────────────────────────────────────────────

function getSurroundingText(pre) {
  var parts = [];
  function collectTextBackward(node, depth) {
    if (depth > 3) return;
    var el = node;
    while (el) {
      el = el.previousSibling;
      if (!el) break;
      if (el.nodeType === 3) {
        var t = (el.textContent || '').trim();
        if (t) parts.push(t);
      } else if (el.nodeType === 1) {
        var tag = el.tagName.toLowerCase();
        if (tag === 'p' || tag === 'div' || tag === 'span' || tag === 'pre' || tag.match(/^h[1-6]$/)) {
          var t = (el.textContent || '').trim();
          if (t && t.length < 500) parts.push(t);
        }
      }
    }
    var parent = node.parentElement;
    if (parent && parent.parentElement) {
      collectTextBackward(parent, depth + 1);
    }
  }
  collectTextBackward(pre, 0);
  return parts.reverse().join(' ').toLowerCase();
}

var INTENT_RULES = [
  { pattern: /\b(add|append|insert)\b/i, endpoint: '/insert', bodyFn: function (code, filename) { return { code: code, filename: filename, position: 'end' }; } },
  { pattern: /\b(run|execute|install)\b/i, endpoint: '/command', bodyFn: function (code, _f) { return { command: code }; } },
  { pattern: /\b(replace|update|fix|change|modify|overwrite)\b/i, endpoint: '/inject', bodyFn: function (code, filename) { return { code: code, filename: filename }; } },
];

function detectIntent(pre) {
  var text = getSurroundingText(pre);
  for (var _i = 0, INTENT_RULES_1 = INTENT_RULES; _i < INTENT_RULES_1.length; _i++) {
    var rule = INTENT_RULES_1[_i];
    if (rule.pattern.test(text)) return rule;
  }
  return INTENT_RULES[2]; // default: /inject
}

// ── Toast ────────────────────────────────────────────────────────

function showToast(message, isError) {
  var existing = document.querySelector('.foundry-toast');
  if (existing) existing.remove();

  var toast = document.createElement('div');
  toast.className = 'foundry-toast';
  toast.textContent = message;
  toast.style.cssText =
    'position:fixed;bottom:24px;right:24px;z-index:999999;' +
    'padding:12px 20px;border-radius:8px;font-size:14px;' +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
    'color:#fff;background:' + (isError ? '#e53e3e' : '#38a169') + ';' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.2);' +
    'transform:translateY(20px);opacity:0;' +
    'transition:all 0.3s ease;pointer-events:none;';

  document.body.appendChild(toast);
  requestAnimationFrame(function () {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  });
  setTimeout(function () {
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 300);
  }, 2500);
}

// ── Network ─────────────────────────────────────────────────────

function sendRequest(endpoint, body) {
  return fetch('http://127.0.0.1:7700' + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Chat input helpers ──────────────────────────────────────────

function findChatInput() {
  var selectors = [
    'textarea[placeholder*="Message DeepSeek"]',
    'textarea[placeholder*="message"]',
    'textarea[placeholder*="Type"]',
    'textarea[placeholder*="Ask"]',
    'div[id="prompt-textarea"]',
    'div[contenteditable="true"]',
    'textarea:not([hidden])',
  ];
  for (var _i = 0; _i < selectors.length; _i++) {
    var el = document.querySelector(selectors[_i]);
    if (el) return el;
  }
  return null;
}

function findSendButton() {
  var selectors = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[class*="send"]',
    'button[class*="Send"]',
    'button[class*="submit"]',
    'button[class*="Submit"]',
  ];
  for (var _i = 0; _i < selectors.length; _i++) {
    var btn = document.querySelector(selectors[_i]);
    if (btn && btn.offsetParent !== null) return btn;
  }
  var form = document.querySelector('form');
  if (form) {
    var btns = form.querySelectorAll('button');
    for (var _b = 0; _b < btns.length; _b++) {
      if (btns[_b].offsetParent !== null) return btns[_b];
    }
  }
  return null;
}

function typeIntoAI(message) {
  var input = findChatInput();
  if (!input) {
    showToast('\u2717 Could not find chat input', true);
    return false;
  }

  var tag = input.tagName.toLowerCase();

  if (tag === 'textarea') {
    input.value = message;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (input.isContentEditable) {
    input.textContent = message;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (tag === 'input') {
    input.value = message;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    showToast('\u2717 Unsupported input type', true);
    return false;
  }

  var sendBtn = findSendButton();
  if (sendBtn) {
    setTimeout(function () { sendBtn.click(); }, 150);
    return true;
  }
  return true;
}

// ── Command capture + feedback loop ─────────────────────────────

function formatOutputMessage(command, output, exitCode) {
  var msg = 'FOUNDRY TERMINAL OUTPUT:\n$ ' + command + '\n';
  msg += output + '\n';
  msg += 'Exit code: ' + (exitCode !== null && exitCode !== undefined ? exitCode : '?');
  msg += '\n\nContinue based on this output.';
  return msg;
}

function pollStatusAndSend(command, timeoutMs) {
  var maxAttempts = Math.ceil(timeoutMs / 2000);
  var attempts = 0;
  var seenOutput = '';

  return new Promise(function (resolve, reject) {
    var interval = setInterval(async function () {
      attempts++;
      try {
        var res = await fetch('http://127.0.0.1:7700/status');
        if (res.ok) {
          var data = await res.json();
          var current = (data.lastCommandOutput || '').trim();

          if (current && current !== seenOutput) {
            seenOutput = current;
          }

          if (data.lastCommandExitCode !== null) {
            clearInterval(interval);
            var exitCode = data.lastCommandExitCode !== null && data.lastCommandExitCode !== undefined
              ? data.lastCommandExitCode : -1;
            var message = formatOutputMessage(command, seenOutput, exitCode);
            typeIntoAI(message);
            showToast('\u2713 Output sent to AI', false);
            resolve();
            return;
          }
        }
      } catch (_e) {}

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        if (seenOutput) {
          var message = formatOutputMessage(command, seenOutput, null);
          typeIntoAI(message);
          showToast('\u2713 Output sent to AI (may be incomplete)', false);
          resolve();
        } else {
          showToast('\u2717 Command timed out', true);
          reject(new Error('timeout'));
        }
      }
    }, 2000);
  });
}

async function handleCommandCapture(code, btn) {
  showToast('\u26A1 Running command \u2014 waiting for output...', false);
  btn.textContent = '\u26A1 Running...';
  btn.style.pointerEvents = 'none';

  var didSubmit = false;

  try {
    var res = await sendRequest('/command', { command: code, capture: true });
    if (res.ok) {
      var data = await res.json();
      var output = (data.output || '').trim();
      var exitCode = data.exitCode !== undefined ? data.exitCode : -1;

      if (output) {
        var message = formatOutputMessage(code, output, exitCode);
        typeIntoAI(message);
        showToast('\u2713 Output sent to AI', false);
        didSubmit = true;
      } else {
        await pollStatusAndSend(code, 28000);
        didSubmit = true;
      }
    }
  } catch (_err) {}

  if (!didSubmit) {
    try {
      await pollStatusAndSend(code, 28000);
    } catch (_e2) {
      showToast('\u2717 Command failed \u2014 VS Code running?', true);
    }
  }

  setTimeout(function () {
    btn.textContent = '\u26A1 Send to VS Code';
    btn.style.pointerEvents = 'auto';
  }, 2500);
}

// ── Menu ────────────────────────────────────────────────────────

var MENU_ITEMS = [
  { label: 'Replace file', endpoint: '/inject', bodyFn: function (code, filename) { return { code: code, filename: filename }; } },
  { label: 'Insert at end', endpoint: '/insert', bodyFn: function (code, filename) { return { code: code, filename: filename, position: 'end' }; } },
  { label: 'Insert at cursor', endpoint: '/insert', bodyFn: function (code, filename) { return { code: code, filename: filename, position: 'cursor' }; } },
  { label: 'Run as command', endpoint: '/command', bodyFn: function (code, _f) { return { command: code, capture: true }; } },
  { label: 'Open file', endpoint: '/open', bodyFn: function (_c, filename) { return { filename: filename }; } },
];

function showMenu(btn, pre, code, filename) {
  var existing = document.querySelector('.foundry-menu');
  if (existing) existing.remove();

  var intent = detectIntent(pre);
  var suggestedEndpoint = intent.endpoint;

  var menu = document.createElement('div');
  menu.className = 'foundry-menu';
  menu.style.cssText =
    'position:fixed;z-index:99999;min-width:170px;' +
    'background:#fff;border:1px solid #e2e8f0;border-radius:8px;' +
    'box-shadow:0 8px 24px rgba(0,0,0,0.15);' +
    'overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
    'font-size:13px;color:#1a202c;';

  for (var _i = 0, MENU_ITEMS_1 = MENU_ITEMS; _i < MENU_ITEMS_1.length; _i++) {
    var item = MENU_ITEMS_1[_i];
    var isSuggested = item.endpoint === suggestedEndpoint;
    var row = document.createElement('div');
    row.style.cssText =
      'padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:6px;' +
      'transition:background 0.15s;' +
      (isSuggested ? 'font-weight:600;' : '');
    row.addEventListener('mouseenter', function () { this.style.background = '#edf2f7'; });
    row.addEventListener('mouseleave', function () { this.style.background = ''; });

    var icon = document.createElement('span');
    icon.textContent = isSuggested ? '\u25C6 ' : '  ';
    row.appendChild(icon);

    var textSpan = document.createElement('span');
    textSpan.textContent = item.label;
    row.appendChild(textSpan);

    row.addEventListener('click', function (item, code, filename, btn) {
      return async function (e) {
        e.stopPropagation();
        menu.remove();
        btn.textContent = '\u23F3 Sending...';
        btn.style.pointerEvents = 'none';

        if (item.endpoint === '/command') {
          await handleCommandCapture(code, btn);
        } else {
          try {
            var res = await sendRequest(item.endpoint, item.bodyFn(code, filename));
            if (res.ok) {
              showToast('\u2713 Sent to VS Code', false);
            } else {
              showToast('\u2717 VS Code not running \u2014 start FOUNDRY', true);
            }
          } catch (_err) {
            showToast('\u2717 VS Code not running \u2014 start FOUNDRY', true);
          }
          setTimeout(function () {
            btn.textContent = '\u26A1 Send to VS Code';
            btn.style.pointerEvents = 'auto';
          }, 2500);
        }
      };
    }(item, code, filename, btn));

    menu.appendChild(row);
  }

  var rect = btn.getBoundingClientRect();
  var menuTop = rect.bottom + 4;
  var menuLeft = rect.left;
  menu.style.top = menuTop + 'px';
  menu.style.left = menuLeft + 'px';
  document.body.appendChild(menu);

  setTimeout(function () {
    var handler = function (e) {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.remove();
        document.removeEventListener('click', handler, true);
      }
    };
    document.addEventListener('click', handler, true);
  }, 0);
}

// ── Buttons ─────────────────────────────────────────────────────

function addButtons() {
  var pres = document.querySelectorAll('pre');
  for (var _i = 0; _i < pres.length; _i++) {
    var pre = pres[_i];
    if (pre.querySelector('.foundry-btn')) continue;

    pre.style.position = 'relative';

    var btn = document.createElement('button');
    btn.className = 'foundry-btn';
    btn.textContent = '\u26A1 Send to VS Code';
    btn.style.cssText =
      'position:absolute;top:8px;right:8px;z-index:1000;padding:4px 10px;' +
      'font-size:12px;border:none;border-radius:4px;cursor:pointer;' +
      'background:#0078d4;color:#fff;font-family:sans-serif;' +
      'white-space:nowrap;opacity:0.9;transition:opacity 0.2s;line-height:1.4;';

    btn.addEventListener('mouseenter', function () { this.style.opacity = '1'; });
    btn.addEventListener('mouseleave', function () { this.style.opacity = '0.9'; });

    (function (btn, pre) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var existing = document.querySelector('.foundry-menu');
        if (existing) { existing.remove(); return; }
        var code = (pre.querySelector('code') ? pre.querySelector('code').textContent : pre.textContent || '').trim();
        var filename = getFilename(pre);
        showMenu(btn, pre, code, filename);
      });
    })(btn, pre);

    pre.appendChild(btn);
  }
}

addButtons();

var observer = new MutationObserver(function () { addButtons(); });
observer.observe(document.body, { childList: true, subtree: true });
