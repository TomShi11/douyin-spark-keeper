/*
 * 集中选择器 / 启发式识别配置 —— 抖音改版时优先修改本文件，
 * 也可在扩展「选项页」用 JSON 覆盖（无需改代码）。
 *
 * 本文件为普通脚本（非 ES module），在内容脚本世界里挂载到
 * globalThis.DSK_SELECTORS，同时支持在 Node 下 require() 做单元测试。
 */
(function () {
  'use strict';

  // ------------------------------ 默认配置（纯数据） ------------------------------
  const DEFAULT_SELECTORS = {
    // 会话（私信）列表容器。真实结构：.conversationConversationListwrapper（滚动容器）
    conversationList: {
      css: [
        '[class*="ConversationListwrapper"]',
        '[class*="conversationList"]',
        '[data-e2e*="conversation-list"]',
        '[data-e2e*="im-conversation-list"]',
        '[class*="conversation"][class*="list"]',
        '[role="list"]'
      ],
      // 结构兜底：子项普遍带头像才算会话列表（区别于消息气泡列表）
      structural: { minItems: 3, requireScrollable: false, avatarRatio: 0.6 },
      // 头像特征，用于结构兜底与稳定标识
      avatarCss: ['img[src*="aweme-avatar"]', 'img[src*="avatar"]', '[class*="avatarContainer"] img']
    },
    // 当前选中的会话（真实结构：class 含 curConversation）
    activeConversation: {
      classKeywords: ['curconversation', 'activeconversation', 'selected', 'active'],
      css: ['[class*="curConversation"]', '[class*="activeConversation"]']
    },
    // 会话项。真实结构：[data-e2e="conversation-item"]，外层包一个 [data-index]
    conversationItem: {
      css: [
        '[data-e2e*="conversation-item"]',
        '[class*="ConversationItemwrapper"]',
        '[class*="conversationItem"]',
        '[role="listitem"]',
        'li'
      ],
      // 会话项在虚拟列表中的稳定序号
      indexAttr: 'data-index'
    },
    // 昵称。真实结构：.conversationConversationItemtitle
    nickname: {
      css: [
        '[class*="ConversationItemtitle"]',
        '[class*="conversationItemTitle"]',
        '[data-e2e*="nickname"]',
        '[class*="nickname"]',
        '[class*="userName"]',
        '[class*="user-name"]'
      ],
      // 昵称附近的干扰节点：火花天数、时间、未读数、消息预览
      stripCss: [
        '[class*="streakContainer"]',
        '[class*="StreaknormalText"]',
        '[class*="timeStr"]',
        '[class*="UnReadCount"]',
        '[class*="ConversationItemHint"]'
      ],
      // 昵称尾部可能粘连的后缀，逐条剥离
      stripSuffixPatterns: [
        '\\s*\\d{1,2}:\\d{2}(:\\d{2})?\\s*$',
        '\\s*\\d{1,3}\\s*(分钟|小时|天|周|个月)前\\s*$',
        '\\s*(刚刚|在线|昨天|今天|前天)\\s*$',
        '\\s*\\d{1,2}[-/月]\\d{1,2}[日]?\\s*$',
        '\\s*重燃中\\s*\\d+\\s*/\\s*\\d+\\s*$',
        '\\s*重燃中\\s*$',
        '\\s+\\d{1,4}\\s*天\\s*$',
        '\\s+\\d{1,4}\\s*$'
      ],
      minLen: 1,
      maxLen: 24,
      // 明显不是昵称的文本（时间、状态等）
      excludePatterns: [
        '^\\d+$',
        '^\\d{1,4}\\s*天$',
        '^\\d{1,2}:\\d{2}$',
        '^(昨天|今天|前天|刚刚)$',
        '^(星期|周)[一二三四五六日天]$',
        '^\\d{1,4}[-/]\\d{1,2}([-/]\\d{1,2})?$',
        '^\\[.*\\]$'
      ]
    },
    // 火花标记识别。真实结构：
    //   <div class="commonStreakstreakContainer">
    //     <img class="commonStreakicon" src=".../flame_icon/normal|bosom|couple/xxx.png" />
    //     <div class="commonStreaknormalText">84</div>   ← 或「重燃中 2/3」
    //   </div>
    spark: {
      // 决定性容器：命中即判定有火花（最高优先级）
      containerCss: [
        '[class*="streakContainer"]',
        '[class*="StreakContainer"]',
        '[class*="Streakcontainer"]'
      ],
      // 火花天数所在节点
      dayTextCss: ['[class*="StreaknormalText"]', '[class*="streakText"]', '[class*="StreakText"]'],
      // 火花图标 URL 特征
      urlKeywords: ['flame_icon', 'huohua', 'flame', 'spark'],
      keywordAttrs: ['aria-label', 'title', 'alt', 'data-e2e', 'data-testid'],
      keywords: ['火花'],
      classKeywords: ['streak', 'spark', 'huohua', 'flame'],
      // 「N 天」形式
      dayPattern: '^(\\d{1,4})\\s*天?$',
      numberPattern: '^(\\d{1,4})$',
      // 「重燃中 2/3」表示火花已断、处于挽回期，同样需要续
      rekindlePattern: '重燃中\\s*(\\d+)\\s*/\\s*(\\d+)',
      // 命中这些词的节点不参与火花判定（未读数等）
      ignoreClassKeywords: ['unread', 'badge', 'dot', 'count', 'notice', 'activedot']
    },
    // 聊天消息区。真实结构：消息项为 .messageMessageBoxmessageBox
    chatMessageList: {
      css: [
        '[class*="MessageBoxlistContainer"]',
        '[class*="messageListContainer"]',
        '[data-e2e*="message-list"]',
        '[class*="messageList"]',
        '[class*="chatList"]',
        '[class*="virtualList"]'
      ],
      structural: { minItems: 1 }
    },
    // 消息气泡。真实结构：.messageMessageBoxmessageBox / [data-e2e="msg-item-content"]
    message: {
      css: [
        '[class*="MessageBoxmessageBox"]',
        '[data-e2e*="msg-item-content"]',
        '[class*="messageBox"]',
        '[data-e2e*="message-item"]',
        '[class*="messageItem"]'
      ]
    },
    // 「自己发出的」气泡判定。真实结构：class 含 isFromMe
    ownMessage: {
      classKeywords: ['isfromme', 'self', 'mine', 'own', 'outgoing'],
      attrs: { 'data-e2e': ['self', 'mine', 'own'], 'data-from': ['self', 'me'] },
      styleAlign: ['flex-end', 'row-reverse']
    },
    // 消息文本内容。真实结构：.TextMessageTextpureText
    messageText: {
      css: ['[class*="TextMessageTextpureText"]', '[class*="bubbleTextContent"]', '[class*="pureText"]']
    },
    // 消息时间戳。真实结构：.MessageBoxTimetimeLayout
    todayDivider: {
      css: ['[class*="Timetimelayout"]', '[class*="TimetimeLayout"]', '[class*="timeLayout"]', '[class*="divider"]', '[class*="timeTip"]'],
      keywords: ['今天'],
      // 「刚刚 / N分钟前 / N小时前」都属于今天
      todayRelativePattern: '^(刚刚|\\d{1,2}\\s*(分钟|小时)前)$',
      /*
       * 纯时刻（HH:MM）也属于今天。
       * 抖音只对几小时内的消息显示「刚刚/N分钟前」，再早就直接显示 09:33 这样的时刻，
       * 只有跨天才会带「昨天/前天/M月D日」前缀。所以不带日期前缀的纯时刻 = 今天。
       * 漏了这条就会把当天早上发的消息当成历史消息，于是重复发送。
       */
      todayClockPattern: '^([01]?\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$',
      // 明确属于过去的前缀（出现这些就不是今天）
      pastPrefixPattern: '^(昨天|前天|\\d{1,2}[-/月]\\d{1,2}|\\d{4}[-/年])',
      maxLen: 20
    },
    // 消息输入框。真实结构：.messageEditorinputArea（editor-kit 富文本，非普通 contenteditable）
    messageInput: {
      css: [
        '[class*="messageEditorinputArea"]',
        '[class*="editor-kit-container"]',
        '[data-e2e*="msg-input"]',
        'div[contenteditable="true"]',
        '[contenteditable="true"]',
        'textarea'
      ]
    },
    // 发送按钮（抖音网页版通常靠回车发送，按钮可能不存在）
    sendButton: {
      css: ['[data-e2e*="send"]', '[class*="sendButton"]', '[class*="sendBtn"]', 'button', '[role="button"]'],
      textKeywords: ['发送', 'send']
    },
    // 未登录特征
    loginBlocker: {
      css: [
        '[data-e2e*="login-panel"]',
        '[data-e2e*="login-button"]',
        '[class*="login-panel"]',
        '[class*="loginPanel"]',
        '[class*="login-guide"]'
      ],
      textKeywords: ['登录后查看', '登录抖音', '扫码登录', '手机号登录', '立即登录'],
      requiresVisible: true
    },
    // 安全验证 / 验证码特征
    captchaBlocker: {
      css: [
        '#captcha_container',
        '[id*="captcha"]',
        '[class*="captcha"]',
        '[class*="verify-wrap"]',
        '[class*="secsdk"]'
      ],
      textKeywords: ['拖动滑块', '安全验证', '请完成验证', '向右滑动'],
      requiresVisible: true
    }
  };

  // ------------------------------ 工具函数 ------------------------------

  function isPlainObject(v) {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  }

  function deepClone(value) {
    if (Array.isArray(value)) return value.map(deepClone);
    if (isPlainObject(value)) {
      const out = {};
      for (const key of Object.keys(value)) out[key] = deepClone(value[key]);
      return out;
    }
    return value;
  }

  // 深合并：对象递归合并，数组整体替换；结果始终为深拷贝，避免污染默认配置
  function deepMerge(base, override) {
    const out = deepClone(base);
    if (!isPlainObject(override)) return out;
    for (const key of Object.keys(override)) {
      const ov = override[key];
      const bv = out[key];
      if (isPlainObject(ov) && isPlainObject(bv)) {
        out[key] = deepMerge(bv, ov);
      } else {
        out[key] = deepClone(ov);
      }
    }
    return out;
  }

  function getSelectors(overrides) {
    if (!isPlainObject(overrides)) return deepMerge(DEFAULT_SELECTORS, {});
    return deepMerge(DEFAULT_SELECTORS, overrides);
  }

  function text(el) {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // jsdom / 无布局环境下 getBoundingClientRect 全为 0，此时跳过几何判定
  function documentHasLayout(doc) {
    try {
      const body = doc && doc.body;
      if (!body) return false;
      const r = body.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    } catch (err) {
      return false;
    }
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const doc = el.ownerDocument;
    const win = doc && (doc.defaultView || doc.parentWindow);
    if (el.hasAttribute && el.hasAttribute('hidden')) return false;
    if (win && typeof win.getComputedStyle === 'function') {
      let style;
      try {
        style = win.getComputedStyle(el);
      } catch (err) {
        style = null;
      }
      if (style) {
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      }
    }
    if (!documentHasLayout(doc)) return true; // 无布局环境（测试）默认可见
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function queryFirstVisible(root, cssList, requireVisible) {
    if (!root || !Array.isArray(cssList)) return null;
    for (const css of cssList) {
      let nodes;
      try {
        nodes = root.querySelectorAll(css);
      } catch (err) {
        continue;
      }
      for (const node of nodes) {
        if (!requireVisible || isVisible(node)) return node;
      }
    }
    return null;
  }


  // 把 class / id / data-e2e 切成 token（同时拆分 camelCase 与连字符），
  // 用于「整词」级别的关键词匹配，避免 message 被 me、other 被 the 之类误命中。
  function tokensOf(el) {
    if (!el || el.nodeType !== 1) return [];
    let cls = '';
    if (typeof el.className === 'string') cls = el.className;
    else if (el.getAttribute) cls = el.getAttribute('class') || '';
    const raw = [cls, el.id || '', (el.getAttribute && el.getAttribute('data-e2e')) || ''].join(' ');
    return raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((t) => t.toLowerCase());
  }

  // 原始 class/id/data-e2e 拼串（小写），用于子串级匹配
  function rawClassString(el) {
    if (!el || el.nodeType !== 1) return '';
    let cls = '';
    if (typeof el.className === 'string') cls = el.className;
    else if (el.getAttribute) cls = el.getAttribute('class') || '';
    return [cls, el.id || '', (el.getAttribute && el.getAttribute('data-e2e')) || ''].join(' ').toLowerCase();
  }

  /**
   * class 关键词匹配。两条通道：
   *  1) token 级：整词相等或前缀（避免 message 被 me 误命中）
   *  2) 子串级：仅对长度 >= 6 的关键词开放，用于匹配抖音的
   *     组件名拼接式 class（如 messageMessageBoxisFromMe 含 isfromme）
   */
  function hasClassToken(el, keywords) {
    if (!el || !Array.isArray(keywords) || keywords.length === 0) return false;
    const tokens = tokensOf(el);
    const raw = rawClassString(el);
    return keywords.some((k) => {
      const key = String(k).toLowerCase();
      if (!key) return false;
      // 过短的词（如 me）即使切成独立 token 也极易误命中拼接式 class，
      // 例如 messageMessageBoxisFromMe 会被拆出 me，故要求至少 3 个字符
      if (key.length >= 3 && tokens.some((t) => t === key || t.startsWith(key))) return true;
      // 长关键词才允许原始子串匹配，用于 isFromMe 这类驼峰拼接
      return key.length >= 6 && raw.includes(key);
    });
  }

  function matchesAnyKeyword(haystack, keywords) {
    if (!haystack || !Array.isArray(keywords)) return false;
    const low = String(haystack).toLowerCase();
    return keywords.some((k) => k && low.includes(String(k).toLowerCase()));
  }

  function isScrollable(el) {
    const doc = el.ownerDocument;
    const win = doc && doc.defaultView;
    if (win && typeof win.getComputedStyle === 'function') {
      try {
        const overflowY = win.getComputedStyle(el).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') return true;
      } catch (err) {
        /* ignore */
      }
    }
    return el.scrollHeight > el.clientHeight + 4;
  }

  // ------------------------------ 会话列表 ------------------------------

  // 结构兜底：找出「拥有最多同构子项」的容器
  function hasAvatar(el, avatarCss) {
    for (const css of avatarCss || []) {
      try {
        if (el.querySelector(css)) return true;
      } catch (err) {
        /* ignore */
      }
    }
    return false;
  }

  function findListByStructure(root, opts, avatarCss) {
    const minItems = (opts && opts.minItems) || 3;
    const requireScrollable = Boolean(opts && opts.requireScrollable);
    const avatarRatio = opts && typeof opts.avatarRatio === 'number' ? opts.avatarRatio : 0;
    const candidates = (root.querySelectorAll ? root.querySelectorAll('*') : []);
    let best = null;
    let bestScore = 0;
    for (const node of candidates) {
      const children = Array.from(node.children || []).filter((c) => c.nodeType === 1);
      if (children.length < minItems) continue;
      const withText = children.filter((c) => text(c).length > 0).length;
      if (withText < minItems) continue;
      // 会话列表的决定性特征：多数子项带头像（消息气泡列表不满足）
      let avatarScore = 0;
      if (avatarRatio > 0) {
        const withAvatar = children.filter((c) => hasAvatar(c, avatarCss)).length;
        if (withAvatar < Math.max(minItems, Math.ceil(children.length * avatarRatio))) continue;
        avatarScore = withAvatar;
      } else {
        // 无头像要求时退回同构判定
        const tag = children[0].tagName;
        const sameTag = children.filter((c) => c.tagName === tag).length;
        if (sameTag < Math.max(minItems, Math.ceil(children.length * 0.7))) continue;
      }
      if (requireScrollable && !isScrollable(node)) continue;
      if (!isVisible(node)) continue;
      const score = avatarScore > 0 ? avatarScore : withText;
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    return best;
  }

  function findConversationList(root, selectors) {
    const sel = (selectors && selectors.conversationList) || DEFAULT_SELECTORS.conversationList;
    const itemSel = (selectors && selectors.conversationItem) || DEFAULT_SELECTORS.conversationItem;
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return null;

    // 语义选择器优先，但必须确认里面真的有会话项
    for (const css of sel.css || []) {
      let nodes;
      try {
        nodes = Array.from(scope.querySelectorAll(css));
      } catch (err) {
        continue;
      }
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        let hasItems = false;
        for (const itemCss of itemSel.css || []) {
          try {
            if (node.querySelector(itemCss)) {
              hasItems = true;
              break;
            }
          } catch (err) {
            /* ignore */
          }
        }
        if (hasItems || hasAvatar(node, sel.avatarCss)) return node;
      }
    }
    return findListByStructure(scope, sel.structural, sel.avatarCss);
  }

  function findConversationItems(listEl, selectors) {
    if (!listEl) return [];
    const sel = (selectors && selectors.conversationItem) || DEFAULT_SELECTORS.conversationItem;
    for (const css of sel.css || []) {
      let nodes;
      try {
        nodes = Array.from(listEl.querySelectorAll(css));
      } catch (err) {
        continue;
      }
      nodes = nodes.filter((n) => isVisible(n) && text(n).length > 0);
      if (nodes.length > 0) return nodes;
    }
    // 结构兜底：直接子元素
    return Array.from(listEl.children || []).filter((n) => n.nodeType === 1 && isVisible(n) && text(n).length > 0);
  }

  // ------------------------------ 昵称 ------------------------------

  function ownText(el) {
    let out = '';
    for (const node of Array.from(el.childNodes || [])) {
      if (node.nodeType === 3) out += node.nodeValue;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function leafTextElements(root) {
    const out = [];
    const walk = (node) => {
      for (const child of Array.from(node.childNodes || [])) {
        if (child.nodeType === 1) walk(child);
      }
      const t = ownText(node);
      if (t) out.push({ el: node, text: t });
    };
    if (root && root.nodeType === 1) walk(root);
    return out;
  }

  // 清洗昵称：剥掉粘连的火花天数、时间、状态等后缀
  function cleanNickname(raw, sel) {
    let t = (raw || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const patterns = (sel && sel.stripSuffixPatterns) || [];
    // 反复剥离，直到不再变化（如「谷超凡 84 39分钟前」需剥两次）
    for (let round = 0; round < 6; round += 1) {
      const before = t;
      for (const p of patterns) {
        t = t.replace(new RegExp(p), '').trim();
      }
      if (t === before) break;
    }
    return t;
  }

  function extractNickname(itemEl, selectors) {
    if (!itemEl) return '';
    const sel = (selectors && selectors.nickname) || DEFAULT_SELECTORS.nickname;
    const excludes = (sel.excludePatterns || []).map((p) => new RegExp(p));
    const acceptable = (value) => {
      const t = cleanNickname(value, sel);
      if (!t) return '';
      if (t.length < (sel.minLen || 1) || t.length > (sel.maxLen || 24)) return '';
      if (excludes.some((re) => re.test(t))) return '';
      return t;
    };

    // 1) 语义选择器直取（真实结构下命中 .conversationConversationItemtitle）
    for (const css of sel.css || []) {
      let nodes;
      try {
        nodes = Array.from(itemEl.querySelectorAll(css));
      } catch (err) {
        continue;
      }
      for (const node of nodes) {
        const t = acceptable(ownText(node) || text(node));
        if (t) return t;
      }
    }

    // 2) 结构兜底：先剔除干扰节点（火花、时间、未读数、消息预览）再取第一个合格文本
    let scope = itemEl;
    try {
      scope = itemEl.cloneNode(true);
      for (const css of sel.stripCss || []) {
        for (const node of Array.from(scope.querySelectorAll(css))) {
          if (node.parentNode) node.parentNode.removeChild(node);
        }
      }
    } catch (err) {
      scope = itemEl;
    }
    for (const leaf of leafTextElements(scope)) {
      const t = acceptable(leaf.text);
      if (t) return t;
    }
    return '';
  }

  /**
   * 会话项的稳定标识。文本会随时间变化（「刚刚」→「1分钟前」），
   * 因此优先用头像 URL 的稳定片段 + 虚拟列表序号。
   */
  function conversationKey(itemEl, selectors) {
    if (!itemEl || itemEl.nodeType !== 1) return null;
    const listSel = (selectors && selectors.conversationList) || DEFAULT_SELECTORS.conversationList;
    const itemSel = (selectors && selectors.conversationItem) || DEFAULT_SELECTORS.conversationItem;

    // 头像 URL：取路径中最长的稳定片段，剥掉易变的 query
    let avatar = null;
    for (const css of listSel.avatarCss || []) {
      let img;
      try {
        img = itemEl.querySelector(css);
      } catch (err) {
        continue;
      }
      const src = img && img.getAttribute('src');
      if (!src) continue;
      // 取文件名整体（去掉 query 与扩展名），保证不同用户的 key 不同
      const noQuery = src.split('?')[0];
      const fileName = (noQuery.split('/').pop() || '').replace(/\.(webp|jpe?g|png|gif|heic)$/i, '');
      avatar = fileName.length >= 8 ? fileName : noQuery.slice(-80);
      break;
    }

    // 虚拟列表序号：在 itemEl 自身或其祖先上
    let index = null;
    const attr = itemSel.indexAttr || 'data-index';
    let node = itemEl;
    for (let depth = 0; node && depth < 4; depth += 1) {
      if (node.getAttribute && node.getAttribute(attr) !== null) {
        index = node.getAttribute(attr);
        break;
      }
      node = node.parentElement;
    }

    if (!avatar && index === null) return null;
    return { avatar, index };
  }

  // 判断某个会话项是否匹配给定 key（头像优先，序号兜底）
  /**
   * 判断会话项是否匹配给定 key。
   * 只认头像 URL —— 虚拟列表滚动时 data-index 会被复用到不同用户身上，
   * 按索引匹配会张冠李戴（表现为「给第一个人重复发、后面的人被跳过」）。
   */
  function matchesConversationKey(itemEl, key, selectors) {
    if (!key || !key.avatar) return false;
    const current = conversationKey(itemEl, selectors);
    if (!current || !current.avatar) return false;
    return key.avatar === current.avatar;
  }
  /**
   * 找出当前被选中（已打开）的会话项。
   * 真实结构：选中项 class 含 curConversation。
   */
  function findActiveConversation(root, selectors) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return null;
    const sel = (selectors && selectors.activeConversation) || DEFAULT_SELECTORS.activeConversation;
    for (const css of sel.css || []) {
      try {
        const node = scope.querySelector(css);
        if (node) return node;
      } catch (err) {
        /* ignore */
      }
    }
    // 兜底：遍历会话项找带选中类名的
    const list = findConversationList(scope, selectors);
    if (!list) return null;
    for (const el of findConversationItems(list, selectors)) {
      if (hasClassToken(el, sel.classKeywords || [])) return el;
      const inner = el.querySelector && el.querySelector('*');
      void inner;
    }
    return null;
  }

  /**
   * 校验当前打开的会话是否为目标本人。
   * 返回 { ok, actualNickname }
   * 这是防止「点击后列表重排导致发错人」的关键闸门。
   */
  function verifyActiveConversation(root, selectors, expectedKey, expectedNickname) {
    const active = findActiveConversation(root, selectors);
    if (!active) return { ok: false, actualNickname: null, reason: 'no_active' };
    const actualNickname = extractNickname(active, selectors);
    // 优先比对头像（最可靠）
    if (expectedKey && expectedKey.avatar) {
      const actualKey = conversationKey(active, selectors);
      if (actualKey && actualKey.avatar) {
        return {
          ok: actualKey.avatar === expectedKey.avatar,
          actualNickname,
          reason: actualKey.avatar === expectedKey.avatar ? 'avatar_match' : 'avatar_mismatch'
        };
      }
    }
    // 退回昵称精确比对
    if (expectedNickname && actualNickname) {
      return { ok: actualNickname === expectedNickname, actualNickname, reason: 'nickname_compare' };
    }
    return { ok: false, actualNickname, reason: 'no_basis' };
  }
  // ------------------------------ 火花识别 ------------------------------

  function iconUrlsOf(el) {
    const urls = [];
    const push = (v) => {
      if (v) urls.push(String(v));
    };
    push(el.getAttribute && el.getAttribute('src'));
    push(el.getAttribute && el.getAttribute('href'));
    push(el.getAttribute && el.getAttribute('xlink:href'));
    const style = el.getAttribute && el.getAttribute('style');
    if (style && style.includes('url(')) push(style);
    return urls;
  }

  function isIgnored(el, sparkSel) {
    return hasClassToken(el, sparkSel.ignoreClassKeywords || []);
  }

  /**
   * 判断一个会话项是否带火花。
   * 真实结构决定性依据：会话项内存在 .commonStreakstreakContainer
   * 返回 { hasSpark, reason, days, rekindle }
   */
  function detectSpark(itemEl, selectors) {
    const sel = (selectors && selectors.spark) || DEFAULT_SELECTORS.spark;
    const result = { hasSpark: false, reason: null, days: null, rekindle: null };
    if (!itemEl || itemEl.nodeType !== 1) return result;

    const dayRe = new RegExp(sel.dayPattern || '^(\\d{1,4})\\s*天?$');
    const rekindleRe = new RegExp(sel.rekindlePattern || '重燃中\\s*(\\d+)\\s*/\\s*(\\d+)');

    // 从火花容器里解析天数 / 重燃进度
    const readStreak = (container) => {
      let dayText = '';
      for (const css of sel.dayTextCss || []) {
        let node;
        try {
          node = container.querySelector(css);
        } catch (err) {
          continue;
        }
        if (node) {
          dayText = text(node);
          break;
        }
      }
      if (!dayText) dayText = text(container);
      const rk = rekindleRe.exec(dayText);
      if (rk) {
        result.rekindle = { current: Number(rk[1]), total: Number(rk[2]) };
        return;
      }
      const dm = dayRe.exec(dayText);
      if (dm) result.days = Number(dm[1]);
    };

    // 1) 火花容器（决定性）
    for (const css of sel.containerCss || []) {
      let container;
      try {
        container = itemEl.querySelector(css);
      } catch (err) {
        continue;
      }
      if (container) {
        result.hasSpark = true;
        result.reason = 'streak-container';
        readStreak(container);
        return result;
      }
    }

    const nodes = [itemEl].concat(itemEl.querySelectorAll ? Array.from(itemEl.querySelectorAll('*')) : []);
    let iconNode = null;

    // 2) 图标 URL 含 flame_icon / huohua / spark
    for (const node of nodes) {
      if (isIgnored(node, sel)) continue;
      const urls = iconUrlsOf(node);
      if (urls.some((u) => matchesAnyKeyword(u, sel.urlKeywords || []))) {
        result.hasSpark = true;
        result.reason = 'icon-url';
        iconNode = node;
        break;
      }
    }

    // 3) 属性含「火花」（强信号，不受 ignoreClassKeywords 影响）
    if (!result.hasSpark) {
      for (const node of nodes) {
        for (const attr of sel.keywordAttrs || []) {
          const v = node.getAttribute && node.getAttribute(attr);
          if (v && matchesAnyKeyword(v, sel.keywords || [])) {
            result.hasSpark = true;
            result.reason = 'attr:' + attr;
            iconNode = node;
            break;
          }
        }
        if (result.hasSpark) break;
      }
    }

    // 4) class 语义含 streak/spark/flame
    if (!result.hasSpark) {
      for (const node of nodes) {
        if (node === itemEl || isIgnored(node, sel)) continue;
        if (hasClassToken(node, sel.classKeywords || [])) {
          result.hasSpark = true;
          result.reason = 'class';
          iconNode = node;
          break;
        }
      }
    }

    const leaves = leafTextElements(itemEl);

    // 5) 「N 天」文本（独立判定依据）
    if (!result.hasSpark) {
      for (const leaf of leaves) {
        if (isIgnored(leaf.el, sel)) continue;
        if (!/天/.test(leaf.text)) continue;
        const m = dayRe.exec(leaf.text);
        if (m) {
          result.hasSpark = true;
          result.reason = 'days-text';
          result.days = Number(m[1]);
          break;
        }
      }
    }

    // 6) 已确认有火花时，补齐天数 / 重燃进度
    if (result.hasSpark && result.days === null && result.rekindle === null) {
      const host = iconNode && iconNode.parentElement ? iconNode.parentElement : itemEl;
      readStreak(host);
    }

    return result;
  }
  // ------------------------------ 聊天区 ------------------------------

  function findChatMessageList(root, selectors) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return null;
    const sel = (selectors && selectors.chatMessageList) || DEFAULT_SELECTORS.chatMessageList;
    const direct = queryFirstVisible(scope, sel.css, true);
    if (direct) return direct;
    // 结构兜底：包含消息气泡最多的容器
    const msgSel = (selectors && selectors.message) || DEFAULT_SELECTORS.message;
    let best = null;
    let bestCount = 0;
    for (const css of msgSel.css || []) {
      let nodes;
      try {
        nodes = Array.from(scope.querySelectorAll(css));
      } catch (err) {
        continue;
      }
      const groups = new Map();
      for (const node of nodes) {
        const parent = node.parentElement;
        if (!parent) continue;
        groups.set(parent, (groups.get(parent) || 0) + 1);
      }
      for (const [parent, count] of groups) {
        if (count > bestCount) {
          bestCount = count;
          best = parent;
        }
      }
      if (best) break;
    }
    return best;
  }

  function findMessages(listEl, selectors) {
    if (!listEl) return [];
    const sel = (selectors && selectors.message) || DEFAULT_SELECTORS.message;
    for (const css of sel.css || []) {
      let nodes;
      try {
        nodes = Array.from(listEl.querySelectorAll(css));
      } catch (err) {
        continue;
      }
      // 去掉嵌套的父子重复（只保留最外层匹配）
      nodes = nodes.filter((n) => !nodes.some((other) => other !== n && other.contains(n)));
      nodes = nodes.filter((n) => text(n).length > 0);
      if (nodes.length > 0) return nodes;
    }
    return Array.from(listEl.children || []).filter((n) => n.nodeType === 1 && text(n).length > 0);
  }

  function isOwnMessage(msgEl, selectors) {
    if (!msgEl) return false;
    const sel = (selectors && selectors.ownMessage) || DEFAULT_SELECTORS.ownMessage;
    const nodes = [msgEl].concat(Array.from(msgEl.querySelectorAll ? msgEl.querySelectorAll('*') : []).slice(0, 30));
    for (const node of nodes) {
      if (hasClassToken(node, sel.classKeywords || [])) return true;
      for (const attr of Object.keys(sel.attrs || {})) {
        const v = node.getAttribute && node.getAttribute(attr);
        if (v && matchesAnyKeyword(v, sel.attrs[attr])) return true;
      }
    }
    const doc = msgEl.ownerDocument;
    const win = doc && doc.defaultView;
    if (win && typeof win.getComputedStyle === 'function') {
      try {
        const style = win.getComputedStyle(msgEl);
        const align = (style.alignSelf || '') + ' ' + (style.justifyContent || '') + ' ' + (style.textAlign || '') + ' ' + (style.flexDirection || '');
        if (matchesAnyKeyword(align, sel.styleAlign || [])) return true;
      } catch (err) {
        /* ignore */
      }
    }
    return false;
  }

  function isTodayDivider(el, selectors, now) {
    const sel = (selectors && selectors.todayDivider) || DEFAULT_SELECTORS.todayDivider;
    const t = text(el);
    if (!t || t.length > (sel.maxLen || 20)) return false;
    if (matchesAnyKeyword(t, sel.keywords || [])) return true;

    // 先排除明确属于过去的（带「昨天/前天/M月D日」等前缀）
    const pastRe = sel.pastPrefixPattern ? new RegExp(sel.pastPrefixPattern) : /^(昨天|前天)/;
    if (pastRe.test(t)) return false;

    // 真实结构无「今天」分隔线，只有相对时间：刚刚 / N分钟前 / N小时前 都属于今天
    if (sel.todayRelativePattern && new RegExp(sel.todayRelativePattern).test(t)) return true;
    /*
     * 纯时刻 09:33 / 13:10 也是今天。
     * 抖音超过几小时就不再显示「N小时前」，改显示时刻；跨天则一定带日期前缀。
     * 上面已排除过带前缀的情况，所以走到这里的纯时刻必然是今天。
     */
    if (sel.todayClockPattern && new RegExp(sel.todayClockPattern).test(t)) return true;
    const d = now instanceof Date ? now : new Date();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const patterns = [
      `${m}月${day}日`,
      `${m}-${day}`,
      `${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      `${d.getFullYear()}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    ];
    return patterns.some((p) => t.includes(p));
  }

  /**
   * 判断「今天是否已有自己发出的消息」。
   * 返回 { sentToday, dividerFound }
   */
  /**
   * 判断「今天是否已有自己发出的消息」。
   * 兼容两种结构：
   *   A) 独立的「今天」分隔线 + 其后的消息（旧版）
   *   B) 每个消息块内部自带时间戳（真实结构 .MessageBoxTimetimeLayout）
   */
  function hasOwnMessageToday(chatListEl, selectors, now) {
    const result = { sentToday: false, dividerFound: false };
    if (!chatListEl) return result;
    const messages = findMessages(chatListEl, selectors);
    if (messages.length === 0) return result;
    const messageSet = new Set(messages);
    const divSel = (selectors && selectors.todayDivider) || DEFAULT_SELECTORS.todayDivider;

    const stampOf = (msg) => {
      for (const css of divSel.css || []) {
        try {
          const node = msg.querySelector(css);
          if (node) return node;
        } catch (err) {
          /* ignore */
        }
      }
      return null;
    };

    // 结构 B（真实结构）：时间戳在消息块内部。
    // 注意抖音只在时间间隔较大时才插入时间戳，连续消息没有时间戳，
    // 因此需要「继承」上一个已知时间戳的归属，否则会漏判今天的消息。
    const stamped = messages.filter((m) => stampOf(m) !== null);
    if (stamped.length > 0) {
      let inToday = false;
      let sawStamp = false;
      for (const msg of messages) {
        const stamp = stampOf(msg);
        if (stamp) {
          sawStamp = true;
          inToday = isTodayDivider(stamp, selectors, now);
          if (inToday) result.dividerFound = true;
        }
        // 没有时间戳的消息，归属继承前一个时间戳
        if (inToday && isOwnMessage(msg, selectors)) {
          result.sentToday = true;
          return result;
        }

      }
      void sawStamp;
      return result;
    }

    /*
     * 整个会话一条时间戳都没有（抖音只在间隔较大时才插时间戳，短会话很常见）。
     * 这种情况下能看到的消息就是最近的对话，里面若有我发的，
     * 只能是今天发的 —— 判定为已发，避免重复打扰。
     * 宁可漏发也不重复：这是本项目一贯的取向。
     */
    if (messages.some((m) => isOwnMessage(m, selectors))) {
      result.sentToday = true;
      result.reason = 'no_stamp_own_message';
      return result;
    }

    // 结构 A：独立分隔线，其后的消息算今天
    const ordered = [];
    const walk = (node) => {
      for (const child of Array.from(node.children || [])) {
        if (messageSet.has(child)) {
          ordered.push({ type: 'message', el: child });
          continue;
        }
        if (isTodayDivider(child, selectors, now)) {
          ordered.push({ type: 'divider', el: child });
          continue;
        }
        walk(child);
      }
    };
    walk(chatListEl);

    let afterToday = false;
    for (const node of ordered) {
      if (node.type === 'divider') {
        afterToday = true;
        result.dividerFound = true;
        continue;
      }
      if (afterToday && isOwnMessage(node.el, selectors)) {
        result.sentToday = true;
        return result;
      }
    }
    return result;
  }

  function findMessageInput(root, selectors) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return null;
    const sel = (selectors && selectors.messageInput) || DEFAULT_SELECTORS.messageInput;
    for (const css of sel.css || []) {
      let nodes;
      try {
        nodes = Array.from(scope.querySelectorAll(css));
      } catch (err) {
        continue;
      }
      for (const node of nodes) {
        if (node.disabled) continue;
        if (node.getAttribute && node.getAttribute('readonly') !== null) continue;
        if (isVisible(node)) return node;
      }
    }
    return null;
  }

  function findSendButton(root, selectors, inputEl) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return null;
    const sel = (selectors && selectors.sendButton) || DEFAULT_SELECTORS.sendButton;
    const keywords = sel.textKeywords || [];
    for (const css of sel.css || []) {
      let nodes;
      try {
        nodes = Array.from(scope.querySelectorAll(css));
      } catch (err) {
        continue;
      }
      for (const node of nodes) {
        if (!isVisible(node) || node.disabled) continue;
        const label = text(node) + ' ' + ((node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('data-e2e'))) || '');
        if (matchesAnyKeyword(label, keywords)) return node;
      }
    }
    // 结构兜底：输入框附近的最后一个按钮
    if (inputEl) {
      let container = inputEl.parentElement;
      for (let depth = 0; depth < 4 && container; depth += 1) {
        const buttons = Array.from(container.querySelectorAll('button, [role="button"]')).filter((b) => isVisible(b) && !b.disabled);
        if (buttons.length > 0) return buttons[buttons.length - 1];
        container = container.parentElement;
      }
    }
    return null;
  }

  // ------------------------------ 阻断检测 ------------------------------

  function detectBlocker(root, selectors, key) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return null;
    const sel = (selectors && selectors[key]) || DEFAULT_SELECTORS[key];
    const node = queryFirstVisible(scope, sel.css, Boolean(sel.requiresVisible));
    if (node) return { matched: true, via: 'css', text: text(node).slice(0, 60) };
    const bodyText = text(scope.body || scope).slice(0, 6000);
    for (const kw of sel.textKeywords || []) {
      if (bodyText.includes(kw)) return { matched: true, via: 'text', text: kw };
    }
    return null;
  }

  function detectLoginBlocker(root, selectors) {
    return detectBlocker(root, selectors, 'loginBlocker');
  }

  function detectCaptchaBlocker(root, selectors) {
    return detectBlocker(root, selectors, 'captchaBlocker');
  }

  // ------------------------------ 名单过滤（纯函数，便于测试） ------------------------------

  function nameMatches(nickname, rule) {
    const name = (nickname || '').trim();
    const r = (rule || '').trim();
    if (!name || !r) return false;
    if (name === r) return true;              // 精确匹配
    return name.includes(r) || r.includes(name); // 包含匹配（双向）
  }

  function matchesList(nickname, list) {
    if (!Array.isArray(list)) return false;
    return list.some((rule) => nameMatches(nickname, rule));
  }

  /**
   * 依据火花识别结果 + 白/黑名单挑选目标。
   * candidates: [{ nickname, hasSpark, days, ... }]
   * 规则：黑名单优先排除 > 白名单强制纳入 > 火花识别结果；最后按顺序截断到 maxPerRun。
   * 返回 { targets, excluded, truncated }
   */
  function selectTargets(candidates, config) {
    const cfg = config || {};
    const whitelist = Array.isArray(cfg.whitelist) ? cfg.whitelist : [];
    const blacklist = Array.isArray(cfg.blacklist) ? cfg.blacklist : [];
    const maxPerRun = Number.isFinite(Number(cfg.maxPerRun)) ? Math.max(1, Math.min(100, Math.trunc(Number(cfg.maxPerRun)))) : 50;
    const targets = [];
    const excluded = [];
    for (const item of Array.isArray(candidates) ? candidates : []) {
      const nickname = (item && item.nickname) || '';
      if (matchesList(nickname, blacklist)) {
        excluded.push({ ...item, excludeReason: 'blacklist' });
        continue;
      }
      if (matchesList(nickname, whitelist)) {
        targets.push({ ...item, includeReason: 'whitelist' });
        continue;
      }
      if (item && item.hasSpark) {
        targets.push({ ...item, includeReason: 'spark' });
        continue;
      }
      excluded.push({ ...item, excludeReason: 'no-spark' });
    }
    const truncated = Math.max(0, targets.length - maxPerRun);
    return { targets: targets.slice(0, maxPerRun), excluded, truncated };
  }
  // ------------------------------ 诊断快照 ------------------------------

  function describeEl(el) {
    if (!el || el.nodeType !== 1) return null;
    const cls = typeof el.className === 'string' ? el.className : '';
    return {
      tag: el.tagName.toLowerCase(),
      cls: cls.slice(0, 120),
      id: (el.id || '').slice(0, 60),
      e2e: (el.getAttribute('data-e2e') || '').slice(0, 60),
      role: (el.getAttribute('role') || '').slice(0, 30),
      children: (el.children || []).length,
      text: text(el).slice(0, 60)
    };
  }

  /**
   * 识别失败时采集页面结构快照，供用户在设置页复制、据此写选择器覆盖。
   */
  function collectDiagnostics(root, selectors) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    const sel = selectors || getSelectors(null);
    const out = {
      url: (doc.defaultView && doc.defaultView.location && doc.defaultView.location.href) || '',
      title: (doc.title || '').slice(0, 80),
      bodyTextHead: text(doc.body).slice(0, 200),
      elementCount: doc.querySelectorAll ? doc.querySelectorAll('*').length : 0,
      selectorHits: {},
      listCandidates: [],
      editableCount: 0
    };

    // 各类选择器命中情况
    for (const key of ['conversationList', 'conversationItem', 'chatMessageList', 'messageInput', 'sendButton']) {
      const cssList = (sel[key] && sel[key].css) || [];
      const hits = {};
      for (const css of cssList) {
        try {
          hits[css] = doc.querySelectorAll(css).length;
        } catch (err) {
          hits[css] = 'invalid';
        }
      }
      out.selectorHits[key] = hits;
    }

    // 「子项最多」的前若干容器，通常其中之一就是会话列表
    const scored = [];
    const all = doc.querySelectorAll ? doc.querySelectorAll('div, ul, ol, section') : [];
    for (const node of all) {
      const children = Array.from(node.children || []).filter((c) => c.nodeType === 1);
      if (children.length < 3) continue;
      const withText = children.filter((c) => text(c).length > 0).length;
      if (withText < 3) continue;
      scored.push({ node, score: withText });
    }
    scored.sort((a, b) => b.score - a.score);
    out.listCandidates = scored.slice(0, 8).map((s) => ({ ...describeEl(s.node), textChildren: s.score }));

    try {
      out.editableCount = doc.querySelectorAll('[contenteditable="true"], textarea').length;
    } catch (err) {
      out.editableCount = 0;
    }
    return out;
  }
  const api = {
    DEFAULT_SELECTORS,
    deepMerge,
    deepClone,
    getSelectors,
    isVisible,
    hasClassToken,
    tokensOf,
    rawClassString,
    text,
    ownText,
    leafTextElements,
    findConversationList,
    findConversationItems,
    extractNickname,
    cleanNickname,
    conversationKey,
    matchesConversationKey,
    findActiveConversation,
    verifyActiveConversation,
    hasAvatar,
    detectSpark,
    findChatMessageList,
    findMessages,
    isOwnMessage,
    isTodayDivider,
    hasOwnMessageToday,
    findMessageInput,
    findSendButton,
    detectLoginBlocker,
    detectCaptchaBlocker,
    describeEl,
    collectDiagnostics,
    nameMatches,
    matchesList,
    selectTargets
  };

  if (typeof globalThis !== 'undefined') globalThis.DSK_SELECTORS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
