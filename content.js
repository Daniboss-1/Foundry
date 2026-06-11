document.documentElement.dataset.foundrySkillsLoaded = 'true';
document.documentElement.dataset.foundryInterceptorAttached = document.querySelector('textarea[placeholder*="Message DeepSeek"]') ? 'true' : 'false';
setupTextareaInterceptor();

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

function stripFoundryUI(text) {
  var idx = text.indexOf('\u26A1');
  if (idx !== -1) text = text.substring(0, idx);
  return text.replace(/Send to VS Code/g, '').trim();
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
    'button[aria-label="Send message"]',
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
    input.focus();
    var sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      var range = document.createRange();
      range.selectNodeContents(input);
      sel.addRange(range);
    }
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, message);
    input.dispatchEvent(new Event('input', { bubbles: true }));
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
    var cleanCode = stripFoundryUI(code);
    var res = await sendRequest("/command", { command: cleanCode, capture: true });
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
        var code = stripFoundryUI(pre.querySelector('code') ? pre.querySelector('code').textContent : pre.textContent || '');
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

// ═══════════════════════════════════════════════════════════════════
// ── SKILL INJECTOR SYSTEM ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

// ── Prompt Helpers ─────────────────────────────────────────────

function readPrompt() {
  var input = findChatInput();
  if (!input) return '';
  var tag = input.tagName.toLowerCase();
  if (tag === 'textarea') return input.value;
  if (input.isContentEditable) return input.textContent || '';
  if (tag === 'input') return input.value;
  return '';
}

function writePrompt(text) {
  var input = findChatInput();
  if (!input) return;
  var tag = input.tagName.toLowerCase();
  if (tag === 'textarea') {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (input.isContentEditable) {
    input.textContent = text;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (tag === 'input') {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ── DuckDuckGo result parser ─────────────────────────────────

function parseDuckDuckGoResults(html) {
  var results = [];
  var parser = new DOMParser();
  var doc = parser.parseFromString(html, 'text/html');
  var snippets = doc.querySelectorAll('.result__snippet, .result__body');
  var count = 0;
  for (var _i = 0; _i < snippets.length && count < 3; _i++) {
    var text = (snippets[_i].textContent || '').trim();
    if (text) {
      results.push(text);
      count++;
    }
  }
  // Fallback: extract text between <a class="result__a"> tags
  if (results.length === 0) {
    var links = doc.querySelectorAll('.result__a');
    for (var _b = 0; _b < links.length && results.length < 3; _b++) {
      var t = (links[_b].textContent || '').trim();
      if (t) results.push(t);
    }
  }
  // Last fallback: grab any visible text block
  if (results.length === 0) {
    var body = doc.body;
    if (body) {
      var texts = body.textContent || '';
      var lines = texts.split('\n').filter(function (l) { return l.trim().length > 40; });
      for (var _c = 0; _c < lines.length && results.length < 3; _c++) {
        results.push(lines[_c].trim().substring(0, 200));
      }
    }
  }
  return results;
}

function extractSearchQuery(prompt, trigger) {
  var idx = prompt.toLowerCase().indexOf(trigger);
  if (idx !== -1) {
    var after = prompt.substring(idx + trigger.length).trim();
    if (after.length > 3) return after.substring(0, 100);
  }
  // fallback: use last 100 chars of prompt
  return prompt.substring(0, 100).trim();
}

// ── Skill Definitions ──────────────────────────────────────────

var SKILL_DEFS = [
  {
    name: 'Current File',
    triggers: [/\b(my file|current file|current code|this function|my code|fix this|fix|bug)\b/i],
    execute: async function () {
      try {
        var statusRes = await fetch('http://127.0.0.1:7700/status');
        if (!statusRes.ok) return null;
        var status = await statusRes.json();
        var activeFile = status.activeFile || '';
        if (!activeFile) return null;
        var fileRes = await fetch('http://127.0.0.1:7700/file?path=' + encodeURIComponent(activeFile));
        if (!fileRes.ok) return null;
        var fileData = await fileRes.json();
        var content = fileData.content || '';
        var filename = activeFile.split('/').pop() || activeFile.split('\\').pop() || 'file';
        return '\n\nCURRENT FILE [' + filename + ']:\n```\n' + content + '\n```';
      } catch (_e) { return null; }
    },
  },
  {
    name: 'TypeScript Errors',
    triggers: [/\b(fix errors|fix bugs|not working|broken|failing)\b/i],
    execute: async function () {
      try {
        var statusRes = await fetch('http://127.0.0.1:7700/status');
        if (!statusRes.ok) return null;
        var status = await statusRes.json();
        var ws = status.workspaceFolder || '';
        if (!ws) return null;
        var cmdRes = await fetch('http://127.0.0.1:7700/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'cd ' + JSON.stringify(ws) + ' && npx tsc --noEmit 2>&1', capture: true }),
        });
        if (!cmdRes.ok) return null;
        var cmdData = await cmdRes.json();
        var output = cmdData.output || 'No errors';
        return '\n\nTYPESCRIPT ERRORS:\n' + output;
      } catch (_e) { return null; }
    },
  },
  {
    name: 'Web Search',
    triggers: [/\b(latest|how to|what is|docs for|documentation|current version)\b/i],
    execute: async function (prompt) {
      var query = extractSearchQuery(prompt, matchTrigger(prompt, this.triggers));
      if (!query) return null;
      try {
        var res = await fetch('https://duckduckgo.com/html/?q=' + encodeURIComponent(query));
        if (!res.ok) return null;
        var html = await res.text();
        var results = parseDuckDuckGoResults(html);
        if (results.length === 0) return null;
        return '\n\nWEB SEARCH RESULTS:\n' + results.join('\n---\n');
      } catch (_e) { return null; }
    },
  },
  {
    name: 'Git Changes',
    triggers: [/\b(what changed|recent changes|git|last commit|diff)\b/i],
    execute: async function () {
      try {
        var statusRes = await fetch('http://127.0.0.1:7700/status');
        if (!statusRes.ok) return null;
        var status = await statusRes.json();
        var ws = status.workspaceFolder || '';
        if (!ws) return null;
        var cmdRes = await fetch('http://127.0.0.1:7700/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'cd ' + JSON.stringify(ws) + ' && git diff HEAD~1 2>&1', capture: true }),
        });
        if (!cmdRes.ok) return null;
        var cmdData = await cmdRes.json();
        var output = cmdData.output || 'No changes';
        return '\n\nRECENT GIT CHANGES:\n' + output;
      } catch (_e) { return null; }
    },
  },
  {
    name: 'Project Context',
    triggers: [/\b(my project|whole codebase|all files|project structure)\b/i],
    execute: async function () {
      try {
        var statusRes = await fetch('http://127.0.0.1:7700/status');
        if (!statusRes.ok) return null;
        var status = await statusRes.json();
        var ws = status.workspaceFolder || '';
        if (!ws) return null;
        var treeRes = await fetch('http://127.0.0.1:7700/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'cd ' + JSON.stringify(ws) + ' && find . -name "*.ts" -not -path "*/node_modules/*" 2>&1', capture: true }),
        });
        if (!treeRes.ok) return null;
        var treeData = await treeRes.json();
        var tree = (treeData.output || '').trim();
        if (!tree) return null;

        var files = tree.split('\n').filter(function (f) { return f.trim(); });
        var contents = '';
        var readCount = 0;
        for (var _i = 0; _i < files.length && readCount < 5; _i++) {
          var f = files[_i].trim();
          if (!f) continue;
          try {
            var fileRes = await fetch('http://127.0.0.1:7700/file?path=' + encodeURIComponent(f));
            if (fileRes.ok) {
              var fd = await fileRes.json();
              contents += '\n--- ' + f + ' ---\n' + (fd.content || '') + '\n';
              readCount++;
            }
          } catch (_e) {}
        }
        return '\n\nPROJECT STRUCTURE:\n' + tree + '\n\nFILES:\n' + contents;
      } catch (_e) { return null; }
    },
  },
];

function matchTrigger(prompt, triggers) {
  for (var _i = 0; _i < triggers.length; _i++) {
    var m = prompt.match(triggers[_i]);
    if (m) return m[0];
  }
  return '';
}

// ── Skill Detection ────────────────────────────────────────────

function detectSkills(prompt) {
  var matched = [];
  for (var _i = 0; _i < SKILL_DEFS.length; _i++) {
    var skill = SKILL_DEFS[_i];
    for (var _b = 0; _b < skill.triggers.length; _b++) {
      if (skill.triggers[_b].test(prompt)) {
        matched.push(skill);
        break;
      }
    }
  }
  return matched;
}

// ── Skill Execution ────────────────────────────────────────────

async function executeSkills(skills, prompt) {
  var results = await Promise.all(skills.map(function (s) {
    try { return s.execute(prompt); }
    catch (_e) { return null; }
  }));
  return results.filter(function (r) { return r; }).join('\n\n');
}

// ── Skill Banner ───────────────────────────────────────────────

var _bannerEl = null;

function showBanner(names) {
  hideBanner();
  var banner = document.createElement('div');
  _bannerEl = banner;
  banner.className = 'foundry-skill-banner';
  banner.textContent = '\u26A1 FOUNDRY injecting: ' + names.join(', ');
  banner.style.cssText =
    'position:fixed;bottom:80px;right:24px;z-index:999998;' +
    'padding:10px 18px;border-radius:8px;font-size:13px;' +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
    'color:#fff;background:#0078d4;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.2);' +
    'transform:translateY(20px);opacity:0;' +
    'transition:all 0.3s ease;pointer-events:none;' +
    'max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  document.body.appendChild(banner);
  requestAnimationFrame(function () {
    banner.style.transform = 'translateY(0)';
    banner.style.opacity = '1';
  });
  // auto-hide after 5s
  setTimeout(hideBanner, 5000);
}

function hideBanner() {
  if (_bannerEl) {
    _bannerEl.style.transform = 'translateY(20px)';
    _bannerEl.style.opacity = '0';
    var el = _bannerEl;
    setTimeout(function () { if (el.parentNode) el.remove(); }, 300);
    _bannerEl = null;
  }
}

// ── Send Interception ──────────────────────────────────────────

var _skillGuard = false;

function setupSkillInterceptor() {
  // Find existing buttons and attach if not already done
  var btns = document.querySelectorAll('button');
  for (var _i = 0; _i < btns.length; _i++) {
    var btn = btns[_i];
    if (btn._foundrySkillAttached) continue;
    if (!btn.offsetParent) continue; // hidden

    var isSendBtn = false;
    var attr = (btn.getAttribute('data-testid') || '').toLowerCase();
    var label = (btn.getAttribute('aria-label') || '').toLowerCase();
    var cls = (btn.className || '').toLowerCase();
    if (attr === 'send-button') isSendBtn = true;
    if (label.indexOf('send') !== -1) isSendBtn = true;
    if (cls.indexOf('send') !== -1) isSendBtn = true;
    // For sites where the last visible button in form is the send
    if (!isSendBtn) {
      var form = btn.closest('form');
      if (form) {
        var visibleBtns = form.querySelectorAll('button');
        if (visibleBtns.length > 0 && visibleBtns[visibleBtns.length - 1] === btn) {
          // Check if there's a chat input nearby
          var input = findChatInput();
          if (input && form.contains(input)) isSendBtn = true;
        }
      }
    }

    if (!isSendBtn) continue;

    btn._foundrySkillAttached = true;

    btn.addEventListener('click', function (e) {
      if (_skillGuard) { _skillGuard = false; return; }

      var prompt = readPrompt();
      if (!prompt || !prompt.trim()) return;

      var skills = detectSkills(prompt);
      if (skills.length === 0) return;

      e.stopPropagation();
      e.preventDefault();

      showBanner(skills.map(function (s) { return s.name; }));

      executeSkills(skills, prompt).then(function (injection) {
        if (injection) {
          writePrompt(prompt + '\n\n' + injection);
        }
        _skillGuard = true;
        setTimeout(function () { btn.click(); }, 150);
      }, function () {
        _skillGuard = true;
        setTimeout(function () { btn.click(); }, 150);
      });
    }, true); // capture phase
  }
}

// ── Textarea Enter key interceptor ────────────────────────────

function setupTextareaInterceptor() {
  var ta = document.querySelector('textarea[placeholder*="Message DeepSeek"]');
  if (!ta) return;
  if (ta._foundryTextareaAttached) return;
  ta._foundryTextareaAttached = true;

  ta.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey) return;

    if (_skillGuard) { _skillGuard = false; return; }

    var prompt = ta.value;
    console.log('FOUNDRY: keydown detected');
    console.log('FOUNDRY: prompt text =', prompt);

    if (!prompt || !prompt.trim()) return;

    var skills = detectSkills(prompt);
    console.log('FOUNDRY: skills matched =', skills.map(function (s) { return s.name; }));

    if (skills.length === 0) return;

    e.preventDefault();
    e.stopPropagation();

    console.log('FOUNDRY: fetching context...');
    showBanner(skills.map(function (s) { return s.name; }));

    executeSkills(skills, prompt).then(function (injection) {
      if (injection) {
        console.log('FOUNDRY: injecting into prompt');
        ta.value = prompt + '\n\n' + injection;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      }
      _skillGuard = true;
      setTimeout(function () {
        var sendBtn = findSendButton();
        if (sendBtn) sendBtn.click();
      }, 100);
    }, function () {
      _skillGuard = true;
      setTimeout(function () {
        var sendBtn = findSendButton();
        if (sendBtn) sendBtn.click();
      }, 100);
    });
  }, true); // capture phase

  document.documentElement.dataset.foundryInterceptorAttached = 'true';
}

// ── Integrate with existing MutationObserver ───────────────────

observer.disconnect();
observer = new MutationObserver(function () {
  addButtons();
  setupSkillInterceptor();
  setupTextareaInterceptor();
});
observer.observe(document.body, { childList: true, subtree: true });

// Also run immediately
setupSkillInterceptor();
setupTextareaInterceptor();
