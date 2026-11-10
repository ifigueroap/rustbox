// Evaluated in the service, alongside inject.js. No DOM text is wrapped or
// replaced: framework-owned nodes, listeners, and drafts remain untouched.
(() => {
  if (window.__rustboxFind) return;
  const allName = "rustbox-find-all";
  const activeName = "rustbox-find-active";
  let query = "";
  let current = -1;
  let selectedRange = null;
  let style = null;

  function clear() {
    window.CSS?.highlights?.delete(allName);
    window.CSS?.highlights?.delete(activeName);
    const selection = window.getSelection();
    if (selectedRange && selection?.rangeCount && selection.getRangeAt(0) === selectedRange) {
      selection.removeAllRanges();
    }
    selectedRange = null;
  }

  function rangesFor(needle) {
    if (!document.body) return [];
    const blocks = new WeakMap();
    function blockFor(element) {
      if (!element || element === document.body) return document.body;
      if (blocks.has(element)) return blocks.get(element);
      const display = getComputedStyle(element).display;
      const block = /^(block|flex|grid|table|list-item|flow-root)/.test(display)
        ? element : blockFor(element.parentElement);
      blocks.set(element, block);
      return block;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches("script,style,noscript,template,svg,canvas,iframe,input,textarea,[contenteditable]:not([contenteditable=false]),[hidden],[inert]")) {
            return NodeFilter.FILTER_REJECT;
          }
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        }
        return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let text = "";
    let lastBlock = null;
    const spans = [];
    let node;
    while ((node = walker.nextNode())) {
      const block = blockFor(node.parentElement);
      if (lastBlock && lastBlock !== block) text += "\n";
      lastBlock = block;
      spans.push({ node, start: text.length, end: text.length + node.nodeValue.length });
      text += node.nodeValue;
    }
    const expression = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    const ranges = [];
    let startIndex = 0;
    let match;
    while ((match = expression.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;
      while (startIndex < spans.length && spans[startIndex].end <= start) startIndex += 1;
      let endIndex = startIndex;
      while (endIndex < spans.length && spans[endIndex].end < end) endIndex += 1;
      if (!spans[startIndex] || !spans[endIndex]) continue;
      const range = document.createRange();
      range.setStart(spans[startIndex].node, Math.max(0, start - spans[startIndex].start));
      range.setEnd(spans[endIndex].node, end - spans[endIndex].start);
      ranges.push(range);
    }
    return ranges;
  }

  window.__rustboxFind = (nextQuery, direction, requestId) => {
    window.__rustboxFindOpen = requestId !== 0;
    let total = 0;
    let failed = false;
    clear();
    try {
      if (!nextQuery) {
        query = "";
        current = -1;
        return;
      }
      const ranges = rangesFor(nextQuery);
      total = ranges.length;
      if (query !== nextQuery || direction === 0) current = direction < 0 ? total - 1 : 0;
      else current = total ? (current + direction + total) % total : -1;
      query = nextQuery;
      current = total ? Math.max(0, Math.min(current, total - 1)) : -1;
      const active = ranges[current];
      if (active) {
        if (window.CSS?.highlights && typeof window.Highlight === "function") {
          if (!style?.isConnected) {
            style = document.createElement("style");
            style.textContent = `::highlight(${allName}){background:#ffe082;color:#201800}::highlight(${activeName}){background:#ef9d48;color:#201800}`;
            (document.head || document.documentElement).append(style);
          }
        }
        if (style?.sheet && window.CSS?.highlights && typeof window.Highlight === "function") {
          const highlights = new window.Highlight();
          ranges.forEach((range) => highlights.add(range));
          window.CSS.highlights.set(allName, highlights);
          window.CSS.highlights.set(activeName, new window.Highlight(active));
        } else {
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(active);
          selectedRange = active;
        }
        const element = active.startContainer.parentElement;
        element?.scrollIntoView?.({ block: "center", inline: "nearest" });
        // scrollIntoView alone targets the whole element. A long paragraph
        // can be taller than its scroller; place the actual match in view.
        if (typeof active.getBoundingClientRect === "function") {
          for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
            const overflow = getComputedStyle(ancestor);
            const box = ancestor.getBoundingClientRect();
            const match = active.getBoundingClientRect();
            if (/(auto|scroll|overlay)/.test(overflow.overflowY) && ancestor.scrollHeight > ancestor.clientHeight) {
              ancestor.scrollTop += match.top - box.top - ancestor.clientHeight / 2;
            }
            if (/(auto|scroll|overlay)/.test(overflow.overflowX) && ancestor.scrollWidth > ancestor.clientWidth) {
              ancestor.scrollLeft += match.left - box.left - ancestor.clientWidth / 2;
            }
          }
          const box = active.getBoundingClientRect();
          if (box.top < 0 || box.bottom > window.innerHeight) {
            window.scrollBy(0, box.top - window.innerHeight / 2);
          }
        }
      }
    } catch (_error) {
      failed = true;
      current = -1;
      clear();
    } finally {
      // Only counts leave the service. The query and page text never do.
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (invoke && requestId) {
        Promise.resolve(invoke("report_find_result", {
          result: { requestId, current: current + 1, total, failed },
        })).catch(() => {});
      }
    }
  };
})();
