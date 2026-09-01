// 配置 / 状态 / 日志的读写与纯逻辑函数。
// 注意：本文件内不在顶层访问 chrome API，便于在 Node 下做单元测试。

import { DEFAULT_CONFIG, DEFAULT_STATE, LOG_LIMIT, CHAT_URL_FALLBACKS, SPARK_TEXT } from './config.js';

/* ------------------------------ 纯函数部分 ------------------------------ */

// 本地时区的日期键：YYYY-MM-DD
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 当天是否已经成功执行过
export function isDoneToday(state, dateKey = todayKey()) {
  return Boolean(state && state.lastSuccessDate === dateKey);
}

function toNameList(value) {
  if (!Array.isArray(value)) {
    if (typeof value === 'string') {
      return toNameList(value.split(/\r?\n/));
    }
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// 归一化聊天页地址：必须是 https://www.douyin.com 下的地址，否则回退默认值
// 归一化发送内容：非空、去首尾空白、限长，空则回退默认 emoji
export function normalizeSparkText(value) {
  if (typeof value !== 'string') return SPARK_TEXT;
  const t = value.trim();
  if (!t) return SPARK_TEXT;
  return t.slice(0, 40);
}
export function normalizeChatUrl(value) {
  const fallback = DEFAULT_CONFIG.chatUrl;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  let url;
  try {
    url = new URL(value.trim());
  } catch (err) {
    return fallback;
  }
  if (url.protocol !== 'https:') return fallback;
  if (url.hostname !== 'www.douyin.com') return fallback;
  return url.toString();
}

// 生成候选聊天页地址：用户配置优先，其余作为回退，去重
export function chatUrlCandidates(config) {
  const primary = normalizeChatUrl(config && config.chatUrl);
  const out = [primary];
  for (const url of CHAT_URL_FALLBACKS) {
    if (!out.includes(url)) out.push(url);
  }
  return out;
}
function clampInt(value, fallback, min, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// 归一化配置：补默认值 + 边界裁剪
export function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const minDelayMs = clampInt(src.minDelayMs, DEFAULT_CONFIG.minDelayMs, 500, 120000);
  let maxDelayMs = clampInt(src.maxDelayMs, DEFAULT_CONFIG.maxDelayMs, 500, 120000);
  if (maxDelayMs < minDelayMs) maxDelayMs = minDelayMs;
  let overrides = null;
  if (src.selectorOverrides && typeof src.selectorOverrides === 'object' && !Array.isArray(src.selectorOverrides)) {
    overrides = src.selectorOverrides;
  }
  return {
    autoRunEnabled: src.autoRunEnabled === undefined ? DEFAULT_CONFIG.autoRunEnabled : Boolean(src.autoRunEnabled),
    chatUrl: normalizeChatUrl(src.chatUrl),
    sparkText: normalizeSparkText(src.sparkText),
    whitelist: toNameList(src.whitelist),
    blacklist: toNameList(src.blacklist),
    maxPerRun: clampInt(src.maxPerRun, DEFAULT_CONFIG.maxPerRun, 1, 100),
    minDelayMs,
    maxDelayMs,
    selectorOverrides: overrides,
    debugDom: Boolean(src.debugDom)
  };
}

export function normalizeState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return { ...DEFAULT_STATE, ...src };
}

// 解析选择器覆盖 JSON（非法则忽略并返回错误信息）
export function parseSelectorOverrides(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return { ok: true, value: null };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { ok: false, value: null, error: `JSON 解析失败：${err.message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, value: null, error: '覆盖内容必须是一个 JSON 对象' };
  }
  return { ok: true, value: parsed };
}

// 日志环形缓冲：新条目追加在末尾，超出上限时丢弃最旧的
export function appendLogEntries(existing, entries, limit = LOG_LIMIT) {
  const base = Array.isArray(existing) ? existing : [];
  const extra = Array.isArray(entries) ? entries : [entries];
  const merged = base.concat(extra.filter((e) => e && typeof e === 'object'));
  if (merged.length <= limit) return merged;
  return merged.slice(merged.length - limit);
}

export function makeLogEntry(level, event, detail, nickname) {
  const entry = { ts: Date.now(), level, event };
  if (nickname) entry.nickname = nickname;
  if (detail !== undefined && detail !== null && detail !== '') entry.detail = String(detail);
  return entry;
}

/* --------------------------- chrome.storage 部分 --------------------------- */

function area() {
  return globalThis.chrome.storage.local;
}

export async function getConfig() {
  const { config } = await area().get('config');
  return normalizeConfig(config);
}

export async function setConfig(patch) {
  const current = await getConfig();
  const next = normalizeConfig({ ...current, ...patch });
  await area().set({ config: next });
  return next;
}

export async function getState() {
  const { state } = await area().get('state');
  return normalizeState(state);
}

export async function patchState(patch) {
  const current = await getState();
  const next = { ...current, ...patch };
  await area().set({ state: next });
  return next;
}

/* ------------------------- 今日已发名单（防重复发送） ------------------------- */

/**
 * 今天已经发过谁。结构：{ date: "YYYY-MM-DD", entries: [{ avatar, nickname, ts }] }
 * 身份用头像图片文件名（唯一稳定标识），昵称只用于日志展示。
 * 跨天自动作废，不需要手动清理。
 */
export function normalizeSentLedger(raw, dateKey = todayKey()) {
  const src = raw && typeof raw === 'object' ? raw : {};
  if (src.date !== dateKey) return { date: dateKey, entries: [] };
  const entries = [];
  const seen = new Set();
  for (const item of Array.isArray(src.entries) ? src.entries : []) {
    const avatar = item && typeof item === 'object' ? item.avatar : item;
    if (typeof avatar !== 'string' || !avatar || seen.has(avatar)) continue;
    seen.add(avatar);
    entries.push({
      avatar,
      nickname: (item && typeof item === 'object' && typeof item.nickname === 'string') ? item.nickname : '',
      ts: (item && typeof item === 'object' && Number.isFinite(Number(item.ts))) ? Number(item.ts) : 0
    });
  }
  return { date: dateKey, entries };
}

// 把新发送记录并进名单（按 avatar 去重，跨天重置）
export function mergeSentEntries(ledger, newEntries, dateKey = todayKey()) {
  const base = normalizeSentLedger(ledger, dateKey);
  const seen = new Set(base.entries.map((e) => e.avatar));
  const list = Array.isArray(newEntries) ? newEntries : [newEntries];
  for (const item of list) {
    const avatar = item && typeof item === 'object' ? item.avatar : item;
    if (typeof avatar !== 'string' || !avatar || seen.has(avatar)) continue;
    seen.add(avatar);
    base.entries.push({
      avatar,
      nickname: (item && typeof item === 'object' && typeof item.nickname === 'string') ? item.nickname : '',
      ts: Date.now()
    });
  }
  return base;
}

export async function getSentLedger() {
  const { sentToday } = await area().get('sentToday');
  return normalizeSentLedger(sentToday);
}

/*
 * 写入必须串行。
 * 内容脚本是「每发出一条就立刻上报」，多条上报会几乎同时到达；
 * 如果各自「读 -> 改 -> 写」，后写的会覆盖先写的，导致名单里只剩最后一个人，
 * 下次执行时前面的人就会被重复发。这里用一条 Promise 链把写入排队。
 */
let ledgerWriteQueue = Promise.resolve();

export function addSentEntries(entries) {
  const task = ledgerWriteQueue.then(async () => {
    const current = await getSentLedger();
    const next = mergeSentEntries(current, entries);
    await area().set({ sentToday: next });
    return next;
  });
  // 队列本身不因单次失败而中断
  ledgerWriteQueue = task.catch(() => {});
  return task;
}

export async function clearSentLedger() {
  await area().set({ sentToday: { date: todayKey(), entries: [] } });
}
export async function getLogs() {
  const { logs } = await area().get('logs');
  return Array.isArray(logs) ? logs : [];
}

export async function addLog(level, event, detail, nickname) {
  const logs = await getLogs();
  const next = appendLogEntries(logs, makeLogEntry(level, event, detail, nickname));
  await area().set({ logs: next });
  return next;
}

export async function addLogs(entries) {
  const logs = await getLogs();
  const next = appendLogEntries(logs, entries);
  await area().set({ logs: next });
  return next;
}

export async function clearLogs() {
  await area().set({ logs: [] });
}
