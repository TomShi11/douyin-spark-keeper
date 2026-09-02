/*
 * 抖音续火花主流程（内容脚本，普通脚本）。
 *
 * 默认完全被动：只有收到后台的 RUN_SESSION 才会操作页面，
 * 用户自己浏览抖音时不会产生任何点击或发送行为。
 *
 * 核心流程（v1.6 起改为「边滚边处理」）：
 *   1. 只读预扫描：滚到底把整个会话列表看一遍，得出「今天要续谁」的名单（仅用于记日志与统计）。
 *   2. 逐轮清扫：每轮从列表顶部开始，在「当前真实渲染出来的」会话项里挑出名单内还没处理过的人，
 *      当场点开、校验、发送。处理完继续在当前位置找，找不到就往下滚，滚到底则本轮结束。
 *      因为永远只对刚刚从 DOM 里拿到的节点动手，不存在「先记住节点、稍后再去找」的失配问题。
 *   3. 一轮结束后若还有人没轮到（列表因新消息重排、虚拟列表回收等原因错过），再清扫一轮，最多 3 轮。
 *
 * 防重复：身份一律用头像图片文件名认人；本次运行内已处理的人记进集合。
 * 跨次运行的防重复**完全以页面为准**：点开会话后读聊天记录，
 * 今天已经有我发出的消息就跳过。不依赖任何本地记录 ——
 * 本地记录会漂移（清了就重发、你自己手动发的它也不认），页面才是唯一真相。
 */
(function () {
  'use strict';

  if (globalThis.__DSK_RUNNER_LOADED__) return;
  globalThis.__DSK_RUNNER_LOADED__ = true;

  const S = globalThis.DSK_SELECTORS;
  const U = globalThis.DSK_UTILS;

  // 与 shared/config.js 保持一致（内容脚本无法 import ESM）
  const SPARK_TEXT = '🔥'; // 火花表情；与 shared/config.js 保持一致，可在设置页改
  const TIMEOUTS = {
    conversationList: 20000,
    chatPanel: 12000,
    sendVerify: 5000,
    scrollSettle: 600,
    pollInterval: 250,
    verifyPoll: 120
  };
  const MAX_SCROLL_ROUNDS = 60;   // 预扫描滚动轮数上限
  const MAX_SWEEPS = 3;           // 清扫轮数上限
  const MAX_SWEEP_STEPS = 300;    // 单轮清扫的动作次数上限（防呆保护）
  const MAX_CONSECUTIVE_FAILURES = 3;
  const MSG = {
    READY: 'READY',
    PING: 'PING',
    PONG: 'PONG',
    PROBE: 'PROBE',
    RUN_SESSION: 'RUN_SESSION',
    PROGRESS: 'PROGRESS',
    DONE: 'DONE',
    ABORT: 'ABORT'
  };
  const ABORT_REASON = {
    NOT_LOGGED_IN: 'not_logged_in',
    CAPTCHA: 'captcha',
    DOM_MISMATCH: 'dom_mismatch',
    CHAT_PAGE_UNAVAILABLE: 'chat_page_unavailable'
  };

  let running = false;

  /* ------------------------------ 与后台通信 ------------------------------ */

  function announceReady() {
    try {
      chrome.runtime.sendMessage({ type: MSG.READY, url: location.href }, () => {
        void chrome.runtime.lastError; // 后台未监听时忽略
      });
    } catch (err) {
      /* ignore */
    }
  }

  // 该框架是否看得到会话列表（用于在多 iframe 页面里挑出正确的执行帧）
  function probe(config) {
    const selectors = S.getSelectors((config && config.selectorOverrides) || null);
    const listEl = S.findConversationList(document, selectors);
    const items = listEl ? S.findConversationItems(listEl, selectors) : [];
    const withNickname = items.filter((el) => S.extractNickname(el, selectors)).length;
    return {
      url: location.href,
      isTop: window === window.top,
      hasList: Boolean(listEl),
      itemCount: items.length,
      nicknameCount: withNickname,
      login: S.detectLoginBlocker(document, selectors),
      captcha: S.detectCaptchaBlocker(document, selectors),
      elementCount: document.querySelectorAll('*').length
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === MSG.PING) {
      sendResponse({ type: MSG.PONG, url: location.href, running });
      return true;
    }
    if (msg && msg.type === MSG.PROBE) {
      let result;
      try {
        result = probe(msg.config);
      } catch (err) {
        result = { url: location.href, hasList: false, error: String(err && err.message) };
      }
      sendResponse(result);
      return true;
    }
    return false;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'spark') return;
    port.onMessage.addListener((msg) => {
      if (!msg || msg.type !== MSG.RUN_SESSION) return;
      if (running) {
        port.postMessage({ type: MSG.ABORT, reason: ABORT_REASON.DOM_MISMATCH, detail: '任务已在执行中' });
        return;
      }
      running = true;
      runSession(port, msg.config || {})
        .catch((err) => {
          safePost(port, { type: MSG.ABORT, reason: ABORT_REASON.DOM_MISMATCH, detail: '运行异常：' + (err && err.message) });
        })
        .finally(() => {
          running = false;
        });
    });
  });

  function safePost(port, payload) {
    try {
      port.postMessage(payload);
    } catch (err) {
      /* 端口已断开 */
    }
  }

  /* ------------------------------ 列表滚动 ------------------------------ */

  // 真实结构中滚动容器可能是列表本身，也可能是它的父级
  // .conversationConversationListwrapper（内层 div 自身不滚动），因此要向上找。
  function findScrollParent(el) {
    let node = el;
    for (let depth = 0; node && depth < 8; depth += 1) {
      if (node.scrollHeight > node.clientHeight + 4) return node;
      let overflowY = '';
      try {
        overflowY = getComputedStyle(node).overflowY;
      } catch (err) {
        overflowY = '';
      }
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.clientHeight > 0) return node;
      node = node.parentElement;
    }
    return null;
  }

  function atListBottom(scroller) {
    if (!scroller) return true;
    return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
  }

  function scrollStep(scroller) {
    return Math.max(120, Math.floor((scroller.clientHeight || 400) * 0.45));
  }

  async function scrollListToTop(scroller) {
    try {
      scroller.scrollTop = 0;
    } catch (err) {
      /* ignore */
    }
    await U.sleep(450);
  }

  /* ------------------------------ 列表推进 ------------------------------ */

  // 当前渲染出来的会话项「指纹」，用来判断虚拟列表是否真的换了内容
  function renderedSignature(listEl, selectors) {
    const items = S.findConversationItems(listEl, selectors);
    const ids = [];
    for (const el of items) {
      const key = S.conversationKey(el, selectors);
      ids.push((key && key.avatar) || S.extractNickname(el, selectors) || '?');
    }
    return ids.join('|');
  }

  /**
   * 把会话列表往下推进一屏。
   *
   * 只改 scrollTop 是不够的：抖音的虚拟列表靠滚动事件 + requestAnimationFrame
   * 决定渲染哪些行，而后台标签页里 rAF 会被浏览器暂停，
   * 于是滚动条动了、渲染的还是原来那 15 行 —— 这正是之前只扫到首屏的原因。
   *
   * 所以这里三招齐上，并且**等到渲染内容真的变化**才返回：
   *   1) 对最后一个已渲染项调用 scrollIntoView（最可靠，能驱动大多数虚拟列表）
   *   2) 直接累加 scrollTop
   *   3) 手动派发 scroll 事件，唤醒只监听事件的实现
   *
   * 返回 'advanced'（渲染变了）/ 'bottom'（到底了）/ 'stuck'（推不动）
   */
  async function advanceList(scroller, listEl, selectors) {
    const before = renderedSignature(listEl, selectors);
    const beforeTop = scroller.scrollTop;
    const wasAtBottom = atListBottom(scroller);

    const items = S.findConversationItems(listEl, selectors);
    const last = items[items.length - 1];
    if (last && typeof last.scrollIntoView === 'function') {
      try {
        last.scrollIntoView({ block: 'end', inline: 'nearest' });
      } catch (err) {
        /* ignore */
      }
    }
    try {
      scroller.scrollTop = Math.max(scroller.scrollTop, beforeTop) + scrollStep(scroller);
    } catch (err) {
      /* ignore */
    }
    try {
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    } catch (err) {
      /* ignore */
    }

    // 等渲染真的换了内容（虚拟列表是异步渲染的，后台标签页尤其慢）
    const changed = await U.waitFor(
      () => (renderedSignature(listEl, selectors) !== before ? true : null),
      2500,
      150
    );
    if (changed) return 'advanced';
    if (wasAtBottom && atListBottom(scroller)) return 'bottom';
    if (Math.abs(scroller.scrollTop - beforeTop) < 1) return 'stuck';
    return atListBottom(scroller) ? 'bottom' : 'stuck';
  }

  // 当前渲染窗口里最小的虚拟列表序号；null 表示页面没有 data-index
  function minRenderedIndex(listEl, selectors) {
    let min = null;
    for (const el of S.findConversationItems(listEl, selectors)) {
      const key = S.conversationKey(el, selectors);
      if (!key || key.index === null || key.index === undefined) continue;
      const idx = Number(key.index);
      if (!Number.isFinite(idx)) continue;
      if (min === null || idx < min) min = idx;
    }
    return min;
  }

  function atRenderedTop(scroller, listEl, selectors) {
    const min = minRenderedIndex(listEl, selectors);
    if (min !== null) return min <= 0;
    return scroller.scrollTop <= 1;
  }

  /**
   * 把会话列表的**渲染窗口**拉回顶部。
   *
   * 这是 advanceList 的反向版，同样不能只改 scrollTop：
   * 预扫描会把列表滚到底，而后台标签页里 rAF 被暂停，
   * 单纯把 scrollTop 归零并不会让虚拟列表重新渲染顶部的行 ——
   * 结果发送阶段面对的还是列表最底部那一屏（往往全是没火花的人），
   * 而 advanceList 只会向下滚，于是立刻判定「到底了」，一个人都发不出去。
   *
   * 返回 true 表示确实回到了顶部。
   */
  async function rewindListToTop(scroller, listEl, selectors) {
    const kick = () => {
      try {
        scroller.scrollTop = 0;
      } catch (err) {
        /* ignore */
      }
      try {
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      } catch (err) {
        /* ignore */
      }
    };

    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (atRenderedTop(scroller, listEl, selectors)) return true;

      const before = renderedSignature(listEl, selectors);

      // 快路径：归零 + 派发 scroll，唤醒事件驱动的虚拟列表
      kick();
      let changed = await U.waitFor(
        () => (renderedSignature(listEl, selectors) !== before ? true : null),
        900,
        150
      );

      // 兜底：让当前首个已渲染项 scrollIntoView 驱动一次，再归零
      if (!changed) {
        const first = S.findConversationItems(listEl, selectors)[0];
        if (first && typeof first.scrollIntoView === 'function') {
          try {
            first.scrollIntoView({ block: 'start', inline: 'nearest' });
          } catch (err) {
            /* ignore */
          }
        }
        kick();
        changed = await U.waitFor(
          () => (renderedSignature(listEl, selectors) !== before ? true : null),
          900,
          150
        );
      }

      // 渲染不再变化且滚动条已在最上面：认为到顶了
      if (!changed && scroller.scrollTop <= 1) {
        return atRenderedTop(scroller, listEl, selectors);
      }
    }
    return atRenderedTop(scroller, listEl, selectors);
  }
  /* ------------------------------ 只读预扫描 ------------------------------ */

  /**
   * 滚到底把整个会话列表看一遍，得到全部会话（含火花信息）。
   * 纯读取，不点任何东西。
   *
   * 注意：这份结果只用来写日志、报个数，**不作为发送名单的唯一依据**。
   * 发送阶段会自己边滚边判断，这样即使这里漏看了谁，也不会漏发。
   */
  async function scanConversations(listEl, scroller, selectors, log, config) {
    const seen = new Map();
    const collect = () => {
      const live = S.findConversationList(document, selectors) || listEl;
      for (const el of S.findConversationItems(live, selectors)) {
        const nickname = S.extractNickname(el, selectors);
        if (!nickname) continue;
        // 身份标识只认头像文件名：昵称含天数/时间会变，data-index 是虚拟列表位置会被复用
        const key = S.conversationKey(el, selectors);
        const id = (key && key.avatar) || ('nick:' + nickname);
        if (seen.has(id)) continue;
        const spark = S.detectSpark(el, selectors);
        seen.set(id, {
          id, nickname, key,
          hasSpark: spark.hasSpark, days: spark.days, rekindle: spark.rekindle, reason: spark.reason
        });
      }
    };

    await scrollListToTop(scroller);
    collect();

    let rounds = 0;
    let bottomHits = 0;
    for (; rounds < MAX_SCROLL_ROUNDS; rounds += 1) {
      const how = await advanceList(scroller, listEl, selectors);
      collect();
      if (how === 'advanced') {
        bottomHits = 0;
        continue;
      }
      // 到底 / 推不动：再确认两次，等懒加载补齐
      bottomHits += 1;
      if (bottomHits >= 3) {
        if (how === 'stuck') log('warn', 'scroll_stuck', `列表推不动了，已扫到 ${seen.size} 个会话`);
        break;
      }
      await U.sleep(TIMEOUTS.scrollSettle);
      collect();
    }

    await rewindListToTop(scroller, listEl, selectors);
    collect();

    const all = Array.from(seen.values());
    const sparkCount = all.filter((c) => c.hasSpark).length;
    log(
      'info', 'scan_done',
      `扫到 ${all.length} 个会话，其中 ${sparkCount} 个有火花（滚动 ${rounds} 轮，列表 ${scroller.scrollHeight}px / 可视 ${scroller.clientHeight}px）`
    );
    if (config && config.debugDom) {
      log('info', 'dom_debug_scan', '有火花：' + all.filter((c) => c.hasSpark).map((c) => `${c.nickname}(${c.days ?? (c.rekindle ? '重燃' : '?')})`).join('、'));
    }
    return all;
  }
  /* ------------------------------ 单个会话发送 ------------------------------ */

  // 消息区会随会话切换整体重建，每次都要重新获取，不能缓存旧引用
  function currentChatList(selectors) {
    return S.findChatMessageList(document, selectors);
  }

  // 当前会话中「我发出的消息」快照：条数 + 最后一条文本
  function ownSnapshot(selectors) {
    const list = currentChatList(selectors);
    if (!list) return { count: 0, lastText: '', totalCount: 0, ok: false };
    // 消息区是倒序渲染的，必须排成「旧 -> 新」，否则 lastText 取到的是最旧那条
    const msgs = S.orderMessagesOldToNew(S.findMessages(list, selectors));
    const own = msgs.filter((m) => S.isOwnMessage(m, selectors));
    return {
      count: own.length,
      lastText: own.length > 0 ? S.text(own[own.length - 1]) : '',
      totalCount: msgs.length,
      ok: true
    };
  }

  function payloadOf(config) {
    const raw = config && typeof config.sparkText === 'string' ? config.sparkText : '';
    return raw.trim() !== '' ? raw : SPARK_TEXT;
  }

  /**
   * 向当前打开的会话发送一条内容。
   * 严格防重发：只触发一次发送动作；校验失败也不重试，宁可漏发也不重复打扰。
   */
  async function sendSparkTo(target, selectors, log, config) {
    const nickname = target.nickname;
    const payload = payloadOf(config);

    const inputEl = await U.waitFor(() => S.findMessageInput(document, selectors), TIMEOUTS.chatPanel, TIMEOUTS.pollInterval);
    if (!inputEl) return { status: 'failed', detail: '未找到消息输入框' };

    /*
     * 今天已经聊过就跳过。
     *
     * 关键：必须等消息真正渲染出来才能判断。
     * 「读不到消息」≠「今天没发过」—— 后台标签页刚打开时消息区是异步加载的，
     * 若此时就下结论，会把已经聊过的人当成没聊过而重复发送
     * （22:02 那次谷超凡、奚路奕、张艺航、吕奇隆 就是这么被重发的：
     *   日志显示扫描完 1 秒内就发出去了，消息区根本还没加载完）。
     * 所以：等到消息区出现且有内容；等不到就跳过，绝不盲发。
     */
    const chatListEl = await U.waitFor(
      () => {
        const list = currentChatList(selectors);
        if (!list) return null;
        // 必须真的有消息节点，空壳容器不算加载完成
        return S.findMessages(list, selectors).length > 0 ? list : null;
      },
      TIMEOUTS.chatPanel,
      TIMEOUTS.pollInterval
    );

    if (!chatListEl) {
      // 读不到聊天记录 -> 无法确认今天有没有发过 -> 宁可漏发也不重复打扰
      log('warn', 'chat_unreadable', '聊天记录没加载出来，无法确认今天是否已聊过，跳过不发', nickname);
      return { status: 'skipped', detail: 'chat_not_loaded' };
    }

    {
      const today = S.hasOwnMessageToday(chatListEl, selectors, new Date());
      if (today.sentToday) {
        log('info', 'skipped_already_sent', '今天已经聊过了，不再打扰', nickname);
        return { status: 'skipped', detail: 'already_sent_today' };
      }
      if (config && config.debugDom) {
        const msgs = S.findMessages(chatListEl, selectors);
        const detail = msgs.slice(-6).map((m) => {
          const stamp = m.querySelector('[class*="TimetimeLayout"],[class*="timeLayout"]');
          return `${S.isOwnMessage(m, selectors) ? '我' : '对'}|${stamp ? S.text(stamp) : '无戳'}|${S.text(m).slice(0, 8)}`;
        }).join(' / ');
        log('info', 'dom_debug_chat', `未跳过，末尾消息：${detail}`, nickname);
      }
    }

    // 发送前快照（实时获取，不用缓存节点）
    const before = ownSnapshot(selectors);

    const typed = U.typeText(inputEl, payload);
    if (!typed) {
      log('warn', 'input_failed', '内容没能写进输入框，为避免误发已跳过', nickname);
      U.clearInput(inputEl);
      return { status: 'failed', detail: '输入框写入失败' };
    }
    // 确认输入框里确实是我们要发的内容，避免把残留内容发出去
    const inputText = U.readInputValue(inputEl).trim();
    if (!inputText.includes(payload)) {
      U.clearInput(inputEl);
      return { status: 'failed', detail: `输入框内容不符（实际："${inputText.slice(0, 20)}"）` };
    }

    if (config && config.debugDom) {
      log('info', 'dom_debug_input', `写入后 innerHTML=${(inputEl.innerHTML || '').slice(0, 200)} 子节点=${inputEl.childNodes.length}`, nickname);
    }

    await U.sleep(200);

    // 只触发一次发送动作：有按钮点按钮，否则回车
    const sendBtn = S.findSendButton(document, selectors, inputEl);
    if (sendBtn) U.humanClick(sendBtn);
    else U.pressEnter(inputEl);

    // 校验：我发出的消息条数增加，或最后一条内容匹配
    const verified = await U.waitFor(
      () => {
        const after = ownSnapshot(selectors);
        if (!after.ok) return null;
        if (after.count > before.count) return 'count';
        if (after.lastText && after.lastText.includes(payload) && after.lastText !== before.lastText) return 'text';
        // 输入框被清空 + 消息总数增加，也算发出去了
        if (U.readInputValue(inputEl).trim() === '' && after.totalCount > before.totalCount) return 'cleared';
        return null;
      },
      TIMEOUTS.sendVerify,
      TIMEOUTS.verifyPoll
    );

    if (verified) {
      const days = target.days !== null && target.days !== undefined
        ? `火花 ${target.days} 天`
        : (target.rekindle ? `重燃中 ${target.rekindle.current}/${target.rekindle.total}` : null);
      return { status: 'sent', detail: days };
    }

    // 不再重试发送：无法确认时按「可能已发出」处理，只清空输入框
    const residue = U.readInputValue(inputEl).trim();
    if (residue === '') {
      // 输入框已被清空，说明抖音接收了这次发送，只是 DOM 没识别到
      log('warn', 'send_unverified', '已经发出去了，只是没能从页面上确认，不会重发', nickname);
      return { status: 'sent', detail: 'unverified_but_cleared' };
    }
    U.clearInput(inputEl);
    return { status: 'failed', detail: '发送没生效，输入框里还有内容' };
  }

  /**
   * 点开一个会话项并发送。
   * 点开后必须确认「当前打开的确实是这个人」才动手 —— 抖音列表会因新消息重排。
   */
  async function openAndSend(itemEl, target, selectors, log, config) {
    const prevList = currentChatList(selectors);
    U.humanClick(itemEl);

    // 等消息区切换完成（旧节点被替换或内容变化），最多 3 秒，就绪即继续
    await U.waitFor(
      () => {
        const now = currentChatList(selectors);
        if (!now) return null;
        if (!prevList) return true;
        return now !== prevList || !prevList.isConnected ? true : null;
      },
      3000,
      150
    );
    await U.sleep(250);

    const captcha = S.detectCaptchaBlocker(document, selectors);
    if (captcha) return { status: 'captcha', detail: captcha.text };

    const verify = await U.waitFor(
      () => {
        const v = S.verifyActiveConversation(document, selectors, target.key, target.nickname);
        return v.ok ? v : null;
      },
      2500,
      150
    ) || S.verifyActiveConversation(document, selectors, target.key, target.nickname);

    if (!verify.ok) {
      log(
        'warn',
        'wrong_conversation',
        `点开后当前是「${verify.actualNickname || '未知'}」，跟目标不是一个人（${verify.reason}），已跳过不发`,
        target.nickname
      );
      return { status: 'skipped', detail: '打开的不是目标本人' };
    }

    return await sendSparkTo(target, selectors, log, config);
  }

  /* ------------------------------ 主流程 ------------------------------ */

  async function runSession(port, config) {
    const selectors = S.getSelectors(config.selectorOverrides);
    const logs = [];
    const log = (level, event, detail, nickname) => {
      const entry = { ts: Date.now(), level, event };
      if (nickname) entry.nickname = nickname;
      if (detail) entry.detail = String(detail);
      logs.push(entry);
      safePost(port, { type: MSG.PROGRESS, log: entry });
    };

    const keepAlive = U.startSilentKeepAlive();
    /*
     * 主动心跳保活 service worker。
     * MV3 的 SW 空闲约 30 秒就会被回收，一旦回收长连接就断，
     * 任务会在中途挂掉（22:03 那次只跑了 55 秒就「内容脚本连接中断」）。
     * 端口上的消息往来会重置这个计时器，所以由内容脚本每 10 秒主动发一次。
     */
    const heartbeat = setInterval(() => safePost(port, { type: MSG.PING }), 10000);
    const finish = (payload) => {
      clearInterval(heartbeat);
      if (keepAlive) keepAlive.stop();
      safePost(port, { ...payload, logs });
    };

    try {
      log('info', 'session_start', location.href);
      log('info', 'payload_info', `这次要发的内容是："${payloadOf(config)}"`);

      // 1) 前置阻断检查：一条消息都不发
      const captcha = S.detectCaptchaBlocker(document, selectors);
      if (captcha) {
        log('error', 'blocked_captcha', captcha.text);
        finish({ type: MSG.ABORT, reason: ABORT_REASON.CAPTCHA, detail: captcha.text });
        return;
      }
      const login = S.detectLoginBlocker(document, selectors);
      const onChatPath = /\/(chat|im)(\/|$)/.test(location.pathname);
      if (login || !onChatPath) {
        const detail = login ? login.text : '页面已跳出聊天页：' + location.href;
        log('error', 'blocked_login', detail);
        finish({ type: MSG.ABORT, reason: ABORT_REASON.NOT_LOGGED_IN, detail });
        return;
      }

      // 2) 找到会话列表与它的滚动容器
      const listEl = await U.waitFor(
        () => S.findConversationList(document, selectors),
        TIMEOUTS.conversationList,
        TIMEOUTS.pollInterval
      );
      if (!listEl) {
        // 等待期间可能弹出了登录框 / 验证码，重新判定一次，避免误报「抖音改版」
        const lateCaptcha = S.detectCaptchaBlocker(document, selectors);
        if (lateCaptcha) {
          log('error', 'blocked_captcha', lateCaptcha.text);
          finish({ type: MSG.ABORT, reason: ABORT_REASON.CAPTCHA, detail: lateCaptcha.text });
          return;
        }
        const lateLogin = S.detectLoginBlocker(document, selectors);
        if (lateLogin) {
          log('error', 'blocked_login', lateLogin.text);
          finish({ type: MSG.ABORT, reason: ABORT_REASON.NOT_LOGGED_IN, detail: lateLogin.text });
          return;
        }
        let diagnostics = null;
        try {
          diagnostics = S.collectDiagnostics(document, selectors);
        } catch (err) {
          diagnostics = { error: String(err && err.message) };
        }
        log('error', 'dom_list_missing', `没找到会话列表（${location.href}）`);
        finish({
          type: MSG.ABORT,
          reason: ABORT_REASON.DOM_MISMATCH,
          detail: '没找到会话列表：' + location.href,
          diagnostics
        });
        return;
      }
      const scroller = findScrollParent(listEl) || listEl;

      // 3) 预扫描：只为了报个数、写日志，让你知道大概有多少人要续
      const scanned = await scanConversations(listEl, scroller, selectors, log, config);
      const scannedSpark = S.selectTargets(scanned, config).targets;
      log(
        'info', 'targets_ready',
        `预计要续 ${scannedSpark.length} 人：` + scannedSpark.map((t) => t.nickname).join('、') +
        '（发送时会再边滚边确认，以实际为准）'
      );

      /*
       * 4) 边滚边发。
       *
       * 关键：待发名单**不是**预扫描定死的。虚拟列表在后台标签页里渲染不稳，
       * 预扫描可能只看到首屏；如果拿它当唯一依据，看漏的人就永远发不到
       * （之前程文轩、姜兆洋就是这样被漏掉的）。
       * 这里改成：每推进一屏，就地判断当前渲染出来的人该不该发，该发就当场发。
       */
      const processed = new Set();   // 已处理过的人（发了 / 跳过 / 失败）
      const details = [];
      let sent = 0, skipped = 0, failed = 0;
      let consecutiveFailures = 0;
      let aborted = null;
      // 预扫描看到、但还没轮到的人
      const remainingExpected = () =>
        scannedSpark.filter((t) => t.key && t.key.avatar && !processed.has(t.key.avatar)).map((t) => t.nickname);

      let sweep = 1;

      const maxPerRun = Number(config.maxPerRun) > 0 ? Number(config.maxPerRun) : 50;
      const blacklist = Array.isArray(config.blacklist) ? config.blacklist : [];
      const whitelist = Array.isArray(config.whitelist) ? config.whitelist : [];

      // 在当前渲染出来的会话项里，挑第一个还没处理、且需要续的人
      const pickNext = () => {
        const live = S.findConversationList(document, selectors) || listEl;
        for (const el of S.findConversationItems(live, selectors)) {
          const key = S.conversationKey(el, selectors);
          if (!key || !key.avatar || processed.has(key.avatar)) continue;
          const nickname = S.extractNickname(el, selectors);
          if (!nickname) continue;
          if (S.matchesList(nickname, blacklist)) {       // 黑名单优先
            processed.add(key.avatar);
            continue;
          }
          const spark = S.detectSpark(el, selectors);
          const wanted = spark.hasSpark || S.matchesList(nickname, whitelist);
          if (!wanted) {
            processed.add(key.avatar);                    // 没火花，记下来不再看
            continue;
          }

          return { el, target: { nickname, key, days: spark.days, rekindle: spark.rekindle } };
        }
        return null;
      };

      /*
       * 预扫描为了看全列表已经滚到了底部，发送前必须把**渲染窗口**拉回顶部。
       * 早期这里只调 scrollListToTop（仅设 scrollTop = 0）：
       * 在后台标签页里渲染窗口纹丝不动地停在列表末尾，
       * 于是 pickNext 只看到最后一屏没火花的人，advanceList 立刻报「到底」，
       * 15 个有火花的人全部沦为 unreached，一条也没发出去。
       */
      const startedAtTop = await rewindListToTop(scroller, listEl, selectors);
      if (!startedAtTop) {
        log('warn', 'rewind_failed', '没能把会话列表拉回顶部，可能会漏掉一部分人');
      }
      if (config && config.debugDom) {
        log('info', 'dom_debug_rewind', '发送前渲染窗口起始序号：' + minRenderedIndex(listEl, selectors));
      }

      let guard = 0;
      while (sent < maxPerRun && !aborted && guard < MAX_SWEEP_STEPS) {
        guard += 1;
        const pick = pickNext();

        if (!pick) {
          // 当前屏没有要发的了，往下推进一屏；到底则收工
          const how = await advanceList(scroller, listEl, selectors);
          if (how === 'advanced') continue;
          // 到底/推不动：再确认两次，防止只是渲染慢
          let recovered = false;
          for (let retry = 0; retry < 2; retry += 1) {
            await U.sleep(TIMEOUTS.scrollSettle);
            if (pickNext()) { recovered = true; break; }
            if (await advanceList(scroller, listEl, selectors) === 'advanced') { recovered = true; break; }
          }
          if (recovered) continue;

          /*
           * 真的推到底了。若预扫描看到的人还有没轮到的
           * （列表因新消息重排、虚拟列表回收等原因错过），
           * 回到顶部再清扫一轮 —— 这才是 MAX_SWEEPS 的用处。
           */
          const left = remainingExpected();
          if (sweep < MAX_SWEEPS && left.length > 0) {
            sweep += 1;
            log('info', 'sweep_again', '列表已到底，还有 ' + left.length + ' 人没轮到，回到顶部再清扫第 ' + sweep + ' 轮');
            if (!(await rewindListToTop(scroller, listEl, selectors))) {
              log('warn', 'rewind_failed', '回不到列表顶部，停止清扫');
              break;
            }
            continue;
          }
          break; // 真的到底了
        }

        processed.add(pick.target.key.avatar); // 无论结果如何都不再重复处理

        const result = await openAndSend(pick.el, pick.target, selectors, log, config);
        if (result.status === 'captcha') {
          log('error', 'blocked_captcha', result.detail);
          aborted = { reason: ABORT_REASON.CAPTCHA, detail: result.detail };
          break;
        }

        details.push({ nickname: pick.target.nickname, status: result.status, detail: result.detail });
        if (result.status === 'sent') {
          sent += 1;
          consecutiveFailures = 0;
          log('info', 'sent', result.detail || `已发送「${payloadOf(config)}」`, pick.target.nickname);
          safePost(port, { type: MSG.PROGRESS, sentEntry: { avatar: pick.target.key.avatar, nickname: pick.target.nickname } });
        } else if (result.status === 'skipped') {
          skipped += 1;
          consecutiveFailures = 0;
          if (result.detail === 'already_sent_today') {
            safePost(port, { type: MSG.PROGRESS, sentEntry: { avatar: pick.target.key.avatar, nickname: pick.target.nickname } });
          }
        } else {
          failed += 1;
          consecutiveFailures += 1;
          log('warn', 'send_failed', result.detail, pick.target.nickname);
        }

        safePost(port, { type: MSG.PROGRESS, sent, skipped, failed });

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          log('error', 'consecutive_failures', `连着 ${consecutiveFailures} 个人都没发出去，先停下来`);
          aborted = { reason: ABORT_REASON.DOM_MISMATCH, detail: `连续 ${consecutiveFailures} 个人发送失败，可能是抖音改版了` };
          break;
        }

        await U.sleep(U.pickDelay(config));
      }

      if (sent >= maxPerRun) log('warn', 'truncated', `已达单次上限 ${maxPerRun} 人，剩下的下次再续`);

      // 预扫描看到、但实际没轮到的人（正常情况下应该为空）
      const missed = remainingExpected();
      if (missed.length > 0) log('warn', 'unreached', `这些人这次没轮到：${missed.join('、')}`);

      if (aborted) {
        finish({ type: MSG.ABORT, reason: aborted.reason, detail: aborted.detail, sent, skipped, failed, details });
        return;
      }

      log('info', 'session_done', `发出 ${sent} 人，跳过 ${skipped} 人，失败 ${failed} 人`);
      finish({ type: MSG.DONE, sent, skipped, failed, details });    } catch (err) {
      finish({ type: MSG.ABORT, reason: ABORT_REASON.DOM_MISMATCH, detail: '运行异常：' + (err && err.message) });
    }
  }

  announceReady();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announceReady, { once: true });
  }
  globalThis.addEventListener('load', announceReady, { once: true });
})();