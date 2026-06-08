chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (tab.url) notifyPanel(tab.url);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active && tab.url) {
    notifyPanel(tab.url);
  }
});

function notifyPanel(url) {
  chrome.runtime.sendMessage({ type: "TAB_CHANGED", url }).catch(() => {});
}
