// Query mode for the GitHub Pages LIFF. Unknown values stay on calendar booking.
function resolvePageMode(modeParam) {
  if (modeParam === 'takkyubin') return 'takkyubin';
  if (modeParam === 'takkyubin_inquiry') return 'takkyubin_inquiry';
  if (modeParam === 'register') return 'register';
  if (modeParam === 'sameday') return 'sameday';
  if (modeParam === 'history_work') return 'history_work';
  if (modeParam === 'history_talk') return 'history_talk';
  return 'calendar';
}

function isHistoryMode(mode) {
  return mode === 'history_work' || mode === 'history_talk';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    resolvePageMode: resolvePageMode,
    isHistoryMode: isHistoryMode
  };
}
