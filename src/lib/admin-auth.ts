/**
 * Admin User Management
 * Single user system - first-time setup then login
 */

import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { randomBytes, createHash } from 'crypto';

const ADMIN_FILE = resolve(process.cwd(), 'data', 'admin.json');

export interface AdminUser {
  username: string;
  email: string;
  passwordHash: string;
  salt: string;
  question: string;   // Security question
  answerHash: string;   // Hashed answer
  createdAt: number;
  lastLoginAt?: number;
}

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(password + salt).digest('hex');
}

function generateSalt(): string {
  return randomBytes(16).toString('hex');
}

function hashAnswer(answer: string, salt: string): string {
  return createHash('sha256').update(answer.toLowerCase().trim() + salt).digest('hex');
}

export interface SetupResult {
  success: true;
}

export async function isAdminSetup(): Promise<boolean> {
  return existsSync(ADMIN_FILE);
}

export async function setupAdmin(
  username: string,
  email: string,
  password: string,
  question: string,
  answer: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (existsSync(ADMIN_FILE)) {
    return { success: false, error: '管理员已设置' };
  }

  const salt = generateSalt();
  const admin: AdminUser = {
    username,
    email,
    passwordHash: hashPassword(password, salt),
    salt,
    question,
    answerHash: hashAnswer(answer, salt),
    createdAt: Date.now(),
  };

  await mkdir(resolve(process.cwd(), 'data'), { recursive: true });
  await writeFile(ADMIN_FILE, JSON.stringify(admin, null, 2), 'utf-8');

  return { success: true };
}

export async function login(
  email: string,
  password: string
): Promise<{ success: true; token: string } | { success: false; error: string }> {
  if (!existsSync(ADMIN_FILE)) {
    return { success: false, error: '系统未初始化' };
  }

  try {
    const content = await readFile(ADMIN_FILE, 'utf-8');
    const admin: AdminUser = JSON.parse(content);

    if (admin.email !== email) {
      return { success: false, error: '邮箱或密码错误' };
    }

    const hash = hashPassword(password, admin.salt);
    if (hash !== admin.passwordHash) {
      return { success: false, error: '邮箱或密码错误' };
    }

    // Update last login
    admin.lastLoginAt = Date.now();
    await writeFile(ADMIN_FILE, JSON.stringify(admin, null, 2), 'utf-8');

    // Generate token
    const token = randomBytes(32).toString('hex');
    return { success: true, token };
  } catch {
    return { success: false, error: '登录失败' };
  }
}

export async function validateToken(token: string): Promise<boolean> {
  // Token stored in memory for now - simpler approach
  return tokenStore.has(token);
}

export async function logout(token: string): Promise<void> {
  tokenStore.delete(token);
}

// Simple in-memory token store
const tokenStore = new Map<string, number>(); // token -> expiry

export function storeToken(token: string): void {
  tokenStore.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
}

export function isValidToken(token: string): boolean {
  const expiry = tokenStore.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    tokenStore.delete(token);
    return false;
  }
  return true;
}

export async function getAdminInfo(): Promise<{ username: string; email: string } | null> {
  if (!existsSync(ADMIN_FILE)) {
    return null;
  }
  try {
    const content = await readFile(ADMIN_FILE, 'utf-8');
    const admin: AdminUser = JSON.parse(content);
    return { username: admin.username, email: admin.email };
  } catch {
    return null;
  }
}

export async function resetAdmin(newUsername: string, newEmail: string, newPassword: string, newQuestion: string, newAnswer: string): Promise<{ success: true } | { success: false; error: string }> {
  const salt = generateSalt();
  const admin: AdminUser = {
    username: newUsername,
    email: newEmail,
    passwordHash: hashPassword(newPassword, salt),
    salt,
    question: newQuestion,
    answerHash: hashAnswer(newAnswer, salt),
    createdAt: Date.now(),
  };

  await writeFile(ADMIN_FILE, JSON.stringify(admin, null, 2), 'utf-8');
  return { success: true };
}
