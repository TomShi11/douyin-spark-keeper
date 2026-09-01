/*
 * 通用 DOM / 时序工具（普通脚本，挂载到 globalThis.DSK_UTILS，同时可被 Node require）。
 * 所有等待都基于 Date.now() 截止时间 + 轮询，后台标签被节流时只会变慢，不会逻辑错乱。
 */
(function () {
  'use strict';

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  function randomInt(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  // 计算会话之间的随机延迟，落在 [minDelayMs, maxDelayMs]
  function pickDelay(config, rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    const min = Number(config && config.minDelayMs);
    const max = Number(config && config.maxDelayMs);
    const lo = Number.isFinite(min) ? min : 3000;
    const hiRaw = Number.isFinite(max) ? max : 8000;
    const hi = Math.max(lo, hiRaw);
    return lo + Math.floor(r() * (hi - lo + 1));
  }

  // 等待条件成立；返回条件值或 null（超时）
  async function waitFor(fn, timeoutMs, intervalMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    const step = Math.max(50, intervalMs || 250);
    for (;;) {
      let value;
      try {
        value = fn();
      } catch (err) {
        value = null;
      }
      if (value) return value;
      if (Date.now() >= deadline) return null;
      await sleep(step);
    }
  }

  // 静音保活：0 增益振荡器让标签保持「有音频播放」，规避后台强节流
  function startSilentKeepAlive() {
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(() => {});
      return {
        stop() {
          try {
            osc.stop();
          } catch (err) {
            /* ignore */
          }
          try {
            ctx.close();
          } catch (err) {
            /* ignore */
          }
        }
      };
    } catch (err) {
      return null;
    }
  }

  function fireMouse(el, type) {
    const doc = el.ownerDocument;
    const win = doc.defaultView || globalThis;
    const evt = new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win, buttons: 1 });
    el.dispatchEvent(evt);
  }

  // 模拟真实点击（含 pointer/mouse 序列）
  function humanClick(el) {
    if (!el) return false;
    try {
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    } catch (err) {
      /* ignore */
    }
    const doc = el.ownerDocument;
    const win = doc.defaultView || globalThis;
    try {
      if (typeof win.PointerEvent === 'function') {
        for (const type of ['pointerover', 'pointerenter', 'pointerdown', 'pointerup']) {
          el.dispatchEvent(new win.PointerEvent(type, { bubbles: true, cancelable: true, view: win, isPrimary: true }));
        }
      }
    } catch (err) {
      /* ignore */
    }
    for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
      try {
        fireMouse(el, type);
      } catch (err) {
        /* ignore */
      }
    }
    return true;
  }

  /**
   * 压平空段落：若编辑器内容里只有一处非空文本，
   * 但被包在多个块级元素中且前面有空块，则重建为「单个块 / 纯文本」。
   */
  function collapseEmptyBlocks(el, expected) {
    if (!el || el.nodeType !== 1) return;
    const clean = (s) => (s || '').replace(/[\s\u200b\ufeff]/g, '');
    if (clean(el.textContent) !== clean(expected)) return;

    const blocks = Array.from(el.children).filter((n) => n.nodeType === 1);
    if (blocks.length === 0) return;

    // 存在空块（无文本、无媒体）就说明有多余空行
    const hasEmptyBlock = blocks.some(
      (b) => clean(b.textContent) === '' && !b.querySelector('img, canvas, svg, video')
    );
    if (!hasEmptyBlock) return;

    // 保留第一个含文本的块，其余空块删掉
    const keep = blocks.find((b) => clean(b.textContent) !== '');
    for (const b of blocks) {
      if (b !== keep && clean(b.textContent) === '' && !b.querySelector('img, canvas, svg, video')) {
        b.remove();
      }
    }
  }
  /**
   * 移除 contenteditable 里的空白节点，避免消息带前后空行。
   * editor-kit 在清空/写入后常留下空的 <br> 或空块级元素。
   */
  function stripLeadingBlanks(el) {
    if (!el || el.nodeType !== 1) return;
    const isBlank = (node) => {
      if (!node) return false;
      if (node.nodeType === 3) return node.nodeValue.replace(/[\s\u200b\ufeff]/g, '') === '';
      if (node.nodeType !== 1) return false;
      if (node.tagName === 'BR') return true;
      // 自身就是有意义元素（表情图片、画布等）
      if (/^(IMG|CANVAS|SVG|VIDEO|INPUT|TEXTAREA|AUDIO|OBJECT|EMBED)$/.test(node.tagName)) return false;
      const txt = (node.textContent || '').replace(/[\s\u200b\ufeff]/g, '');
      if (txt !== '') return false;
      // 空容器，且内部不含有意义内容
      return !node.querySelector('img, canvas, svg, video, input, textarea, audio, object, embed');
    };
    // 去掉开头的空节点
    while (el.firstChild && isBlank(el.firstChild)) el.removeChild(el.firstChild);
    // 去掉结尾的空节点
    while (el.lastChild && isBlank(el.lastChild)) el.removeChild(el.lastChild);
  }
  function readInputValue(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return (el.textContent || '').replace(/\u200b/g, '');
  }

  // 全选输入框内容（contenteditable 用）
  function selectAllIn(el) {
    const doc = el.ownerDocument;
    const win = doc.defaultView || globalThis;
    try {
      const sel = win.getSelection && win.getSelection();
      if (!sel || !doc.createRange) return false;
      const range = doc.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * 清空输入框。
   * 关键：contenteditable 不能直接 textContent = ''，那样会残留空段落节点，
   * editor-kit 会把它当成一个空行，导致发出的消息上方多一个空白行。
   * 正确做法是走「全选 + 删除」让编辑器自己维护内部模型。
   */
  function clearInput(el) {
    if (!el) return;
    const doc = el.ownerDocument;
    const win = doc.defaultView || globalThis;

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
      if (setter && setter.set) setter.set.call(el, '');
      else el.value = '';
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      return;
    }

    if ((el.childNodes || []).length === 0) return;

    try {
      el.focus();
    } catch (err) {
      /* ignore */
    }

    // 首选：全选后交给编辑器删除
    if (selectAllIn(el)) {
      try {
        el.dispatchEvent(
          new win.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' })
        );
      } catch (err) {
        /* ignore */
      }
      try {
        if (typeof doc.execCommand === 'function') doc.execCommand('delete', false, null);
      } catch (err) {
        /* ignore */
      }
    }

    // 兜底：仍有文本残留时硬清
    if (readInputValue(el) !== '') {
      while (el.firstChild) el.removeChild(el.firstChild);
      try {
        el.dispatchEvent(new win.Event('input', { bubbles: true }));
      } catch (err) {
        /* ignore */
      }
    }

    // 文本虽已空，但可能残留 <br> 或空块（正是空白行的元凶），一并清掉
    stripLeadingBlanks(el);
    if (readInputValue(el) === '' && (el.childNodes || []).length > 0) {
      const onlyBlanks = Array.from(el.childNodes).every(
        (n) => (n.nodeType === 3 && n.nodeValue.trim() === '') || (n.nodeType === 1 && !n.querySelector('img, canvas, svg, video'))
      );
      if (onlyBlanks) {
        while (el.firstChild) el.removeChild(el.firstChild);
      }
    }
  }

  /**
   * 把光标放到编辑器内容的末尾（塌陷选区）。
   * editor-kit 只在有合法选区时才接受 insertText。
   */
  function placeCaretAtEnd(el) {
    const doc = el.ownerDocument;
    const win = doc.defaultView || globalThis;
    try {
      const s = win.getSelection && win.getSelection();
      if (!s || !doc.createRange) return false;
      const range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      s.removeAllRanges();
      s.addRange(range);
      return true;
    } catch (err) {
      return false;
    }
  }

  function selectAllContents(el) {
    const doc = el.ownerDocument;
    const win = doc.defaultView || globalThis;
    try {
      const s = win.getSelection && win.getSelection();
      if (!s || !doc.createRange) return false;
      const range = doc.createRange();
      range.selectNodeContents(el);
      s.removeAllRanges();
      s.addRange(range);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * 归一化编辑器内容，确保「只有一行、且这一行就是要发的内容」。
   *
   * 空白行的真正来源：editor-kit 的空状态本身就是一个空段落（<div><br></div> 之类），
   * insertText 会把文字插到这个空段落「之后」，于是消息变成「空行 + 内容」。
   * 这里在发送前做最后一道校正：只要文本已经正确，就把多余的空块全部摘掉；
   * 如果剩下的块超过一个，就压成单个块。
   */
  function normalizeEditorContent(el, expected) {
    if (!el || el.nodeType !== 1) return;
    const clean = (s) => (s || '').replace(/[\s\u200b\ufeff\u00a0]/g, '');
    if (clean(el.textContent) !== clean(expected)) return;

    const meaningful = 'img, canvas, svg, video, input, textarea, audio, object, embed';
    const isBlank = (node) => {
      if (!node) return false;
      if (node.nodeType === 3) return clean(node.nodeValue) === '';
      if (node.nodeType !== 1) return true;
      if (node.tagName === 'BR') return true;
      if (node.matches && node.matches(meaningful)) return false;
      if (clean(node.textContent) !== '') return false;
      return !(node.querySelector && node.querySelector(meaningful));
    };

    // 摘掉所有空白子节点（前导空块就是消息上方那个空行）
    for (const node of Array.from(el.childNodes)) {
      if (isBlank(node)) node.remove();
    }

    // 仍有多个块（比如内容被拆成两段）-> 压成一个块，保留原来的块标签与 class，
    // 让 editor-kit 的样式/序列化逻辑仍能正常工作。
    const blocks = Array.from(el.children);
    if (blocks.length > 1) {
      const keep = blocks.find((b) => clean(b.textContent) !== '') || blocks[0];
      for (const b of blocks) {
        if (b !== keep) b.remove();
      }
    }

    // 块内部还有空的 <br> / 空 span，一并清掉
    const inner = el.firstElementChild;
    if (inner) {
      for (const node of Array.from(inner.childNodes)) {
        if (isBlank(node)) node.remove();
      }
    }
  }

  // 向输入框写入文本：textarea 用原生 setter，contenteditable 用 InputEvent + execCommand 兜底
  function typeText(el, textValue) {
    if (!el) return false;
    const doc = el.ownerDocument;
    const win = doc.defaultView || globalThis;
    try {
      el.focus();
    } catch (err) {
      /* ignore */
    }

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement : win.HTMLInputElement;
      const desc = proto && Object.getOwnPropertyDescriptor(proto.prototype, 'value');
      if (desc && desc.set) desc.set.call(el, textValue);
      else el.value = textValue;
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
      return readInputValue(el).includes(textValue);
    }

    /*
     * contenteditable（抖音用字节自研 editor-kit 富文本）。
     *
     * 关键点：
     *  - 不能先 clearInput 再插入。clearInput 后编辑器会补一个空段落，
     *    insertText 追加在其后 -> 消息上方永远多一个空行。
     *  - 也不能直接改 textContent，那会破坏编辑器内部模型。
     *  - 正确顺序：全选已有内容（包含空状态的那个空段落）-> insertText 替换它。
     *  - 最后再用 normalizeEditorContent 把残留的空块摘掉做双保险。
     */
    const matchesExpected = () => readInputValue(el).replace(/[\s\u200b\ufeff\u00a0]/g, '') === textValue.replace(/\s/g, '');

    // 方式一：全选 + insertText 替换（editor-kit 首选路径）
    selectAllContents(el);
    try {
      el.dispatchEvent(
        new win.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: textValue })
      );
    } catch (err) {
      /* ignore */
    }
    try {
      if (typeof doc.execCommand === 'function') doc.execCommand('insertText', false, textValue);
    } catch (err) {
      /* ignore */
    }

    // 方式二：模拟粘贴（同样替换选区）
    if (!matchesExpected()) {
      try {
        selectAllContents(el);
        const dt = new win.DataTransfer();
        dt.setData('text/plain', textValue);
        el.dispatchEvent(new win.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      } catch (err) {
        /* ignore */
      }
    }

    // 方式三：直接写单个文本节点（清光所有子节点，杜绝空段落）
    if (!matchesExpected()) {
      try {
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(doc.createTextNode(textValue));
        placeCaretAtEnd(el);
      } catch (err) {
        /* ignore */
      }
    }

    // 统一收尾：摘掉残留的空块（这是消息上方空行的元凶），并把光标放到末尾
    normalizeEditorContent(el, textValue);
    placeCaretAtEnd(el);

    // 通知编辑器内容已变化
    try {
      el.dispatchEvent(
        new win.InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText', data: textValue })
      );
    } catch (err) {
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
    }

    return matchesExpected();
  }
  // 回车发送兜底
  function pressEnter(el) {
    if (!el) return false;
    const win = el.ownerDocument.defaultView || globalThis;
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    try {
      el.focus();
    } catch (err) {
      /* ignore */
    }
    el.dispatchEvent(new win.KeyboardEvent('keydown', init));
    el.dispatchEvent(new win.KeyboardEvent('keypress', init));
    el.dispatchEvent(new win.KeyboardEvent('keyup', init));
    return true;
  }

  function scrollToBottom(el) {
    if (!el) return 0;
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  }

  const api = {
    sleep,
    randomInt,
    pickDelay,
    waitFor,
    startSilentKeepAlive,
    humanClick,
    typeText,
    pressEnter,
    readInputValue,
    clearInput,
    selectAllIn,
    selectAllContents,
    placeCaretAtEnd,
    normalizeEditorContent,
    stripLeadingBlanks,
    collapseEmptyBlocks,
    scrollToBottom
  };

  if (typeof globalThis !== 'undefined') globalThis.DSK_UTILS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
