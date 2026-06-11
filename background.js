function inject(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  }).catch(function () {});
  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: function () { window.__foundrySkillsLoaded = true; }
  }).catch(function () {});
}

function matchesTarget(url) {
  var targets = [
    'chat.deepseek.com',
    'web.kimi.ai',
    'claude.ai',
    'chatgpt.com'
  ];
  return targets.some(function (t) { return url.indexOf(t) !== -1; });
}

// Inject on tab update (SPA navigation)
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete' && tab.url && matchesTarget(tab.url)) {
    inject(tabId);
  }
});

// Inject on already-open tabs
chrome.tabs.query({}, function (tabs) {
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].url && matchesTarget(tabs[i].url)) {
      inject(tabs[i].id);
    }
  }
});
