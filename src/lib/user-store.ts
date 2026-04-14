/**
 * 多用户数据层
 * 用户数据存储在 data/users.json
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { randomBytes, createHash, randomUUID } from 'crypto';

const USERS_FILE = resolve(process.cwd(), 'data', 'users.json');
const ADMIN_FILE = resolve(process.cwd(), 'data', 'admin.json');

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  salt: string;
  question: string;
  answerHash: string;
  role: 'admin' | 'user';
  personalDir: string;
  avatar?: string;
  createdAt: number;
  lastLoginAt?: number;
  createdBy?: string;
}

export type PublicUser = Omit<User, 'passwordHash' | 'salt' | 'answerHash'>;

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(password + salt).digest('hex');
}

function generateSalt(): string {
  return randomBytes(16).toString('hex');
}

function hashAnswer(answer: string, salt: string): string {
  return createHash('sha256').update(answer.toLowerCase().trim() + salt).digest('hex');
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash, salt, answerHash, ...pub } = user;
  return pub;
}

// Simple in-process mutex for file operations
let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve: () => void;
  writeLock = new Promise<void>(r => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

export async function loadUsers(): Promise<User[]> {
  if (!existsSync(USERS_FILE)) return [];
  try {
    const content = await readFile(USERS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveUsers(users: User[]): Promise<void> {
  await mkdir(resolve(process.cwd(), 'data'), { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

export async function getUserById(id: string): Promise<User | undefined> {
  const users = await loadUsers();
  return users.find(u => u.id === id);
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const users = await loadUsers();
  return users.find(u => u.email === email);
}

export async function getUserByUsername(username: string): Promise<User | undefined> {
  const users = await loadUsers();
  return users.find(u => u.username === username);
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await loadUsers();
  return users.map(toPublicUser);
}

export async function createUser(data: {
  username: string;
  email: string;
  password: string;
  question: string;
  answer: string;
  role: 'admin' | 'user';
  personalDir: string;
  avatar?: string;
  createdBy?: string;
}): Promise<PublicUser> {
  return withLock(async () => {
    const users = await loadUsers();
    if (users.find(u => u.email === data.email)) {
      throw new Error('邮箱已存在');
    }
    if (users.find(u => u.username === data.username)) {
      throw new Error('用户名已存在');
    }
    const salt = generateSalt();
    const user: User = {
      id: randomUUID(),
      username: data.username,
      email: data.email,
      passwordHash: hashPassword(data.password, salt),
      salt,
      question: data.question,
      answerHash: hashAnswer(data.answer, salt),
      role: data.role,
      personalDir: data.personalDir,
      avatar: data.avatar,
      createdAt: Date.now(),
      createdBy: data.createdBy,
    };
    users.push(user);
    await saveUsers(users);
    return toPublicUser(user);
  });
}

export async function updateUser(id: string, patch: Partial<Pick<User, 'username' | 'email' | 'role' | 'personalDir' | 'avatar'>>): Promise<PublicUser> {
  return withLock(async () => {
    const users = await loadUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error('用户不存在');
    if (patch.email && patch.email !== users[idx].email) {
      if (users.find(u => u.email === patch.email && u.id !== id)) throw new Error('邮箱已存在');
    }
    if (patch.username && patch.username !== users[idx].username) {
      if (users.find(u => u.username === patch.username && u.id !== id)) throw new Error('用户名已存在');
    }
    Object.assign(users[idx], patch);
    await saveUsers(users);
    return toPublicUser(users[idx]);
  });
}

export async function deleteUser(id: string): Promise<void> {
  return withLock(async () => {
    const users = await loadUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error('用户不存在');
    users.splice(idx, 1);
    await saveUsers(users);
    // Clean up tokens for this user
    for (const [token, info] of tokenStore.entries()) {
      if (info.userId === id) tokenStore.delete(token);
    }
  });
}

export async function changePassword(userId: string, currentPwd: string, newPwd: string): Promise<void> {
  return withLock(async () => {
    const users = await loadUsers();
    const user = users.find(u => u.id === userId);
    if (!user) throw new Error('用户不存在');
    if (hashPassword(currentPwd, user.salt) !== user.passwordHash) {
      throw new Error('当前密码错误');
    }
    // Keep same salt so answerHash remains valid
    user.passwordHash = hashPassword(newPwd, user.salt);
    await saveUsers(users);
  });
}

export async function changeEmail(userId: string, newEmail: string): Promise<void> {
  return withLock(async () => {
    const users = await loadUsers();
    const user = users.find(u => u.id === userId);
    if (!user) throw new Error('用户不存在');
    if (users.find(u => u.email === newEmail && u.id !== userId)) throw new Error('邮箱已存在');
    user.email = newEmail;
    await saveUsers(users);
  });
}

export async function resetPasswordByQuestion(email: string, answer: string, newPwd: string): Promise<void> {
  return withLock(async () => {
    const users = await loadUsers();
    const user = users.find(u => u.email === email);
    if (!user) throw new Error('用户不存在');
    if (hashAnswer(answer, user.salt) !== user.answerHash) {
      throw new Error('密保答案错误');
    }
    user.passwordHash = hashPassword(newPwd, user.salt);
    await saveUsers(users);
  });
}

export async function getSecurityQuestion(email: string): Promise<string> {
  const users = await loadUsers();
  const user = users.find(u => u.email === email);
  if (!user) throw new Error('用户不存在');
  return user.question;
}

export async function adminResetPassword(userId: string, newPwd: string): Promise<void> {
  return withLock(async () => {
    const users = await loadUsers();
    const user = users.find(u => u.id === userId);
    if (!user) throw new Error('用户不存在');
    user.passwordHash = hashPassword(newPwd, user.salt);
    await saveUsers(users);
  });
}

// --- Token Store (multi-user, persisted to disk) ---
const TOKENS_FILE = resolve(process.cwd(), 'data', 'tokens.json');
const tokenStore = new Map<string, { userId: string; expiry: number }>();
let tokensLoaded = false;

function loadTokensSync(): void {
  if (tokensLoaded) return;
  tokensLoaded = true;
  try {
    if (existsSync(TOKENS_FILE)) {
      const content = require('fs').readFileSync(TOKENS_FILE, 'utf-8');
      const entries: [string, { userId: string; expiry: number }][] = JSON.parse(content);
      const now = Date.now();
      for (const [token, info] of entries) {
        if (info.expiry > now) tokenStore.set(token, info);
      }
    }
  } catch { /* ignore corrupt file */ }
}

function persistTokens(): void {
  try {
    const { mkdirSync, writeFileSync } = require('fs');
    mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
    writeFileSync(TOKENS_FILE, JSON.stringify([...tokenStore.entries()]), 'utf-8');
  } catch { /* ignore */ }
}

export function storeToken(token: string, userId: string): void {
  loadTokensSync();
  tokenStore.set(token, { userId, expiry: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  persistTokens();
}

export function validateToken(token: string): { userId: string } | null {
  loadTokensSync();
  const info = tokenStore.get(token);
  if (!info) return null;
  if (info.expiry < Date.now()) {
    tokenStore.delete(token);
    persistTokens();
    return null;
  }
  return { userId: info.userId };
}

export function removeToken(token: string): void {
  loadTokensSync();
  tokenStore.delete(token);
  persistTokens();
}

export async function login(email: string, password: string): Promise<{ success: true; token: string; user: PublicUser } | { success: false; error: string }> {
  const users = await loadUsers();
  const user = users.find(u => u.email === email);
  if (!user) return { success: false, error: '邮箱或密码错误' };
  if (hashPassword(password, user.salt) !== user.passwordHash) {
    return { success: false, error: '邮箱或密码错误' };
  }
  // Update last login
  user.lastLoginAt = Date.now();
  await withLock(async () => {
    const all = await loadUsers();
    const u = all.find(x => x.id === user.id);
    if (u) { u.lastLoginAt = user.lastLoginAt; await saveUsers(all); }
  });
  const token = randomBytes(32).toString('hex');
  storeToken(token, user.id);
  return { success: true, token, user: toPublicUser(user) };
}

// --- Migration from admin.json ---
export async function migrateFromAdminJson(): Promise<boolean> {
  if (existsSync(USERS_FILE)) return false;
  if (!existsSync(ADMIN_FILE)) return false;
  try {
    const content = await readFile(ADMIN_FILE, 'utf-8');
    const admin = JSON.parse(content);
    const user: User = {
      id: randomUUID(),
      username: admin.username,
      email: admin.email,
      passwordHash: admin.passwordHash,
      salt: admin.salt,
      question: admin.question || '',
      answerHash: admin.answerHash || '',
      role: 'admin',
      personalDir: '',
      createdAt: admin.createdAt || Date.now(),
      lastLoginAt: admin.lastLoginAt,
    };
    await mkdir(resolve(process.cwd(), 'data'), { recursive: true });
    await writeFile(USERS_FILE, JSON.stringify([user], null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export async function isSetup(): Promise<boolean> {
  await migrateFromAdminJson();
  const users = await loadUsers();
  return users.some(u => u.role === 'admin');
}

export async function setupFirstAdmin(data: {
  username: string;
  email: string;
  password: string;
  question: string;
  answer: string;
  personalDir?: string;
  avatar?: string;
}): Promise<PublicUser> {
  const users = await loadUsers();
  if (users.some(u => u.role === 'admin')) {
    throw new Error('管理员已设置');
  }
  return createUser({
    ...data,
    role: 'admin',
    personalDir: data.personalDir || '',
  });
}
