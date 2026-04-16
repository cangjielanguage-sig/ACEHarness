import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import open from 'open';
import prompts from 'prompts';
import { getConcreteEngines } from '@/lib/engine-metadata';
import { isEngineAvailable, type EngineType } from '@/lib/engines/engine-factory';
import { getAceDirectory, getAppConfigPath, getEngineConfigPath, getNotebookDataRoot, getDataDir, getRepoRoot } from '@/lib/app-paths';
import { loadSystemSettings, saveSystemSettings, type SystemSettings } from '@/lib/system-settings';
import { isSetup, setupFirstAdmin } from '@/lib/user-store';

type Locale = 'zh' | 'en';

interface AppConfig {
  engine?: EngineType;
}

interface CliMessages {
  setupCancelled: string;
  welcome: string;
  runtimeHome: string;
  languagePrompt: string;
  languageChoices: Array<{ title: string; value: Locale }>;
  detectEngines: string;
  chooseEngine: string;
  skipKeepDefault: string;
  noEnginesDetected: string;
  createAdmin: string;
  adminUsername: string;
  adminEmail: string;
  adminPassword: string;
  securityQuestion: string;
  securityAnswer: string;
  usernameRequired: string;
  validEmailRequired: string;
  passwordTooShort: string;
  securityQuestionRequired: string;
  securityAnswerRequired: string;
  defaultSecurityQuestion: string;
  portPrompt: string;
  lanAccessPrompt: string;
  yes: string;
  no: string;
  skip: string;
  openBrowserFallback: (url: string) => string;
  startingServer: (url: string) => string;
  failedToStart: (message: string) => string;
}

const CLI_MESSAGES: Record<Locale, CliMessages> = {
  zh: {
    setupCancelled: '初始化已取消',
    welcome: '[ACE] 欢迎使用。首次启动将初始化本地运行配置。',
    runtimeHome: '运行目录',
    languagePrompt: '请选择语言',
    languageChoices: [
      { title: '中文', value: 'zh' },
      { title: 'English', value: 'en' },
    ],
    detectEngines: '现在检测可用引擎吗？',
    chooseEngine: '选择默认引擎',
    skipKeepDefault: '跳过，保留当前/默认设置',
    noEnginesDetected: '[ACE] 未检测到受支持的引擎，将使用当前/默认引擎。',
    createAdmin: '现在创建管理员账号吗？',
    adminUsername: '管理员用户名',
    adminEmail: '管理员邮箱',
    adminPassword: '管理员密码',
    securityQuestion: '安全问题',
    securityAnswer: '安全答案',
    usernameRequired: '用户名不能为空',
    validEmailRequired: '请输入有效邮箱',
    passwordTooShort: '至少 6 个字符',
    securityQuestionRequired: '安全问题不能为空',
    securityAnswerRequired: '安全答案不能为空',
    defaultSecurityQuestion: '你的团队名称是什么？',
    portPrompt: '使用的端口',
    lanAccessPrompt: '启用局域网访问吗？',
    yes: '是',
    no: '否',
    skip: '跳过',
    openBrowserFallback: (url: string) => `[ACE] 请在浏览器中打开 ${url}`,
    startingServer: (url: string) => `[ACE] 正在启动服务：${url}`,
    failedToStart: (message: string) => `[ACE] 启动失败：${message}`,
  },
  en: {
    setupCancelled: 'Setup cancelled',
    welcome: '[ACE] Welcome. First-time setup will initialize local runtime configuration.',
    runtimeHome: 'Runtime home',
    languagePrompt: 'Choose your language',
    languageChoices: [
      { title: 'English', value: 'en' },
      { title: '中文', value: 'zh' },
    ],
    detectEngines: 'Detect available engines now?',
    chooseEngine: 'Choose a default engine',
    skipKeepDefault: 'Skip and keep current/default',
    noEnginesDetected: '[ACE] No supported engines were detected. Using the current/default engine.',
    createAdmin: 'Create an admin account now?',
    adminUsername: 'Admin username',
    adminEmail: 'Admin email',
    adminPassword: 'Admin password',
    securityQuestion: 'Security question',
    securityAnswer: 'Security answer',
    usernameRequired: 'Username is required',
    validEmailRequired: 'Enter a valid email',
    passwordTooShort: 'At least 6 characters',
    securityQuestionRequired: 'Security question is required',
    securityAnswerRequired: 'Security answer is required',
    defaultSecurityQuestion: 'What is your team name?',
    portPrompt: 'Port to use',
    lanAccessPrompt: 'Enable LAN access?',
    yes: 'yes',
    no: 'no',
    skip: 'skip',
    openBrowserFallback: (url: string) => `[ACE] Open ${url} in your browser.`,
    startingServer: (url: string) => `[ACE] Starting server on ${url}`,
    failedToStart: (message: string) => `[ACE] Failed to start: ${message}`,
  },
};

function getLocaleMessages(locale: Locale): CliMessages {
  return CLI_MESSAGES[locale];
}

function normalizeLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'zh';
}

function getPromptOptions(locale: Locale) {
  return {
    onCancel: () => {
      throw new Error(getLocaleMessages(locale).setupCancelled);
    },
  };
}

async function ensureRuntimeDirs() {
  await Promise.all([
    mkdir(getAceDirectory('workspace'), { recursive: true }),
    mkdir(getAceDirectory('config'), { recursive: true }),
    mkdir(getDataDir(), { recursive: true }),
    mkdir(getAceDirectory('cache'), { recursive: true }),
    mkdir(getAceDirectory('logs'), { recursive: true }),
    mkdir(getNotebookDataRoot(), { recursive: true }),
  ]);
}

async function loadAppConfig(): Promise<AppConfig> {
  if (!existsSync(getAppConfigPath())) return {};
  try {
    return JSON.parse(await readFile(getAppConfigPath(), 'utf-8')) as AppConfig;
  } catch {
    return {};
  }
}

async function saveAppConfig(config: AppConfig) {
  await writeFile(getAppConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
  if (config.engine) {
    await writeFile(getEngineConfigPath(), JSON.stringify({ engine: config.engine, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
  }
}

async function detectEngines() {
  const engines = getConcreteEngines();
  const availability = await Promise.all(
    engines.map(async (engine) => ({
      ...engine,
      available: await isEngineAvailable(engine.id),
    }))
  );
  return availability;
}

async function promptForLocale(initialLocale: Locale): Promise<Locale> {
  const messages = getLocaleMessages(initialLocale);
  const answer = await prompts({
    type: 'select',
    name: 'value',
    message: messages.languagePrompt,
    choices: messages.languageChoices,
    initial: messages.languageChoices.findIndex((choice) => choice.value === initialLocale),
  }, getPromptOptions(initialLocale));

  return normalizeLocale(answer.value);
}

function buildAdminPrompts(messages: CliMessages) {
  return [
    {
      type: 'text',
      name: 'username',
      message: messages.adminUsername,
      initial: 'admin',
      validate: (value: string) => value.trim() ? true : messages.usernameRequired,
    },
    {
      type: 'text',
      name: 'email',
      message: messages.adminEmail,
      validate: (value: string) => value.includes('@') ? true : messages.validEmailRequired,
    },
    {
      type: 'password',
      name: 'password',
      message: messages.adminPassword,
      validate: (value: string) => value.length >= 6 ? true : messages.passwordTooShort,
    },
    {
      type: 'text',
      name: 'question',
      message: messages.securityQuestion,
      initial: messages.defaultSecurityQuestion,
      validate: (value: string) => value.trim() ? true : messages.securityQuestionRequired,
    },
    {
      type: 'text',
      name: 'answer',
      message: messages.securityAnswer,
      validate: (value: string) => value.trim() ? true : messages.securityAnswerRequired,
    },
  ];
}

async function runFirstLaunchWizard() {
  await ensureRuntimeDirs();

  const settings = await loadSystemSettings();
  const appConfig = await loadAppConfig();
  const adminExists = await isSetup();

  const initialLocale = normalizeLocale(settings.locale);
  const locale = await promptForLocale(initialLocale);
  const messages = getLocaleMessages(locale);

  console.log(messages.welcome);
  console.log(`[ACE] ${messages.runtimeHome}: ${getAceDirectory('workspace')}`);

  const shouldDetectEnginesAnswer = await prompts({
    type: 'toggle',
    name: 'value',
    message: messages.detectEngines,
    initial: true,
    active: messages.yes,
    inactive: messages.skip,
  }, getPromptOptions(locale));

  const shouldDetectEngines = Boolean(shouldDetectEnginesAnswer.value);
  const detected = shouldDetectEngines ? await detectEngines() : [];
  const availableChoices = detected.filter((item) => item.available);

  let selectedEngine = appConfig.engine || 'claude-code';
  if (shouldDetectEngines) {
    if (availableChoices.length > 0) {
      const engineAnswer = await prompts({
        type: 'select',
        name: 'value',
        message: messages.chooseEngine,
        choices: [
          { title: messages.skipKeepDefault, value: '__skip__' },
          ...availableChoices.map((item) => ({ title: item.name, value: item.id })),
        ],
        initial: Math.max(availableChoices.findIndex((item) => item.id === selectedEngine) + 1, 0),
      }, getPromptOptions(locale));

      if (engineAnswer.value && engineAnswer.value !== '__skip__') {
        selectedEngine = engineAnswer.value as EngineType;
      }
    } else {
      console.log(messages.noEnginesDetected);
    }
  }

  if (!adminExists) {
    const adminAnswer = await prompts({
      type: 'toggle',
      name: 'value',
      message: messages.createAdmin,
      initial: false,
      active: messages.yes,
      inactive: messages.skip,
    }, getPromptOptions(locale));

    if (adminAnswer.value) {
      const adminForm = await prompts(buildAdminPrompts(messages), getPromptOptions(locale));

      await setupFirstAdmin({
        username: adminForm.username.trim(),
        email: adminForm.email.trim(),
        password: adminForm.password,
        question: adminForm.question.trim(),
        answer: adminForm.answer.trim(),
        personalDir: '',
      });
    }
  }

  const networkForm = await prompts([
    {
      type: 'number',
      name: 'port',
      message: messages.portPrompt,
      initial: settings.port || 3000,
      min: 1,
      max: 65535,
    },
    {
      type: 'toggle',
      name: 'lanAccess',
      message: messages.lanAccessPrompt,
      initial: Boolean(settings.lanAccess),
      active: messages.yes,
      inactive: messages.no,
    },
  ], getPromptOptions(locale));

  await saveAppConfig({
    ...appConfig,
    engine: selectedEngine,
  });

  await saveSystemSettings({
    ...settings,
    locale,
    port: Number(networkForm.port || settings.port || 3000),
    lanAccess: Boolean(networkForm.lanAccess),
    host: networkForm.lanAccess ? '0.0.0.0' : '127.0.0.1',
    onboardingCompleted: true,
  });
}

async function syncBrowserLocale(settings: SystemSettings) {
  if (!settings.locale) return;
  process.env.ACE_LOCALE = settings.locale;
}

async function start() {
  await ensureRuntimeDirs();
  const settings = await loadSystemSettings();
  if (!settings.onboardingCompleted) {
    await runFirstLaunchWizard();
  }

  const nextSettings = await loadSystemSettings();
  const locale = normalizeLocale(nextSettings.locale);
  const messages = getLocaleMessages(locale);
  await syncBrowserLocale({ ...nextSettings, locale });

  process.env.ACE_HOST = nextSettings.host || (nextSettings.lanAccess ? '0.0.0.0' : '127.0.0.1');
  process.env.ACE_PORT = String(nextSettings.port || 3000);
  process.env.PORT = process.env.ACE_PORT;
  process.env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
  };

  const urlHost = process.env.ACE_HOST === '0.0.0.0' ? '127.0.0.1' : process.env.ACE_HOST;
  const url = `http://${urlHost}:${process.env.ACE_PORT}`;

  setTimeout(() => {
    open(url).catch(() => {
      console.log(messages.openBrowserFallback(url));
    });
  }, 1200);

  console.log(messages.startingServer(url));
  process.chdir(getRepoRoot());
  await import('../server.js');
}

start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const locale = normalizeLocale(process.env.ACE_LOCALE);
  console.error(getLocaleMessages(locale).failedToStart(message));
  process.exit(1);
});
