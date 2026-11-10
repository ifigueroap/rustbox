// Explicit per-service preference. No script is injected for the platform default.
(() => {
  const enabled = __RUSTBOX_SPELLCHECK__;
  const apply = () => {
    if (document.documentElement && document.documentElement.spellcheck !== enabled) {
      document.documentElement.spellcheck = enabled;
    }
    document.querySelectorAll('input, textarea, [contenteditable], [spellcheck]').forEach((node) => {
      if (node.spellcheck !== enabled) node.spellcheck = enabled;
    });
  };
  new MutationObserver(apply).observe(document, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['spellcheck', 'contenteditable'],
  });
  apply();
})();
