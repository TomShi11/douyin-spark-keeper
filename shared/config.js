// 默认配置与常量。所有可调参数集中在此。

// 聊天页地址。抖音存在多个聊天路由，默认用独立聊天窗口页 /chat?isPopup=1。
// 若抖音再次调整路由，可在设置页用 chatUrl 覆盖，无需改代码。
export const IM_URL = 'https://www.douyin.com/chat?isPopup=1';

// 备选聊天页：主地址打不开会话列表时依次尝试
export const CHAT_URL_FALLBACKS = [
  'https://www.douyin.com/chat?isPopup=1',
  'https://www.douyin.com/chat',
  'https://www.douyin.com/im'
];

// 判定「当前页面是否聊天页」的路径特征
export const CHAT_PATH_PATTERN = /\/(chat|im)(\/|$)/;
// 发送内容：默认就是火花表情 🔥。
// 注意不要用 [火花] 这种方括号写法，抖音不会解析，会原样发成文字。
// 可在设置页改成其他 emoji 或文字。
export const SPARK_TEXT = '🔥';

export const ALARM_RUN = 'spark:run';
export const ALARM_RETRY = 'spark:retry';

// 启动后随机延迟窗口（分钟）
export const STARTUP_DELAY_MIN_MINUTES = 1;
export const STARTUP_DELAY_MAX_MINUTES = 5;

// 一般性失败重试
export const RETRY_PERIOD_MINUTES = 30;
export const MAX_RETRY_PER_DAY = 3;

// 后台等待内容脚本 READY 握手的最长时间（毫秒）
export const HANDSHAKE_TIMEOUT_MS = 45000;
// 单次任务总时长保护（毫秒）
export const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
// 单个框架探测的响应超时（毫秒）
export const PROBE_TIMEOUT_MS = 3000;
// 框架探测重试间隔（毫秒）
export const FRAME_PROBE_INTERVAL_MS = 1500;
// 会话列表出现的最长等待（毫秒），含 SPA 首屏渲染
export const CHAT_READY_TIMEOUT_MS = 30000;

// 长连接心跳（毫秒），用于 service worker 保活
export const PORT_HEARTBEAT_MS = 10000; // 必须明显小于 MV3 的 30 秒空闲回收

// 日志环形缓冲上限
export const LOG_LIMIT = 200;

export const DEFAULT_CONFIG = {
  autoRunEnabled: true,
  chatUrl: IM_URL,
  sparkText: SPARK_TEXT,
  whitelist: [],
  blacklist: [],
  maxPerRun: 50,
  minDelayMs: 2000,
  maxDelayMs: 5000,
  selectorOverrides: null,
  // 开启后会把输入框/消息区的真实 DOM 片段写进日志，用于排查问题
  debugDom: false
};

export const DEFAULT_STATE = {
  lastSuccessDate: null,
  lastRunAt: null,
  lastResult: null,
  retryCount: 0,
  todaySentCount: 0
};

// 内容脚本内部超时（毫秒）
export const TIMEOUTS = {
  conversationList: 20000,
  chatPanel: 12000,
  sendVerify: 5000,
  scrollSettle: 600,
  // 发送校验的轮询间隔，越小越快确认
  verifyPoll: 120,
  pollInterval: 250
};

// 会话列表滚动加载上限
// 会话列表滚动加载轮数上限（虚拟列表需滚到底，长列表要足够轮数）
export const MAX_SCROLL_ROUNDS = 60;
// 连续发送校验失败次数达到此值则提前中止
export const MAX_CONSECUTIVE_FAILURES = 3;
