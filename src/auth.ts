export interface AuthStore {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface UserRecord {
  email: string;
  salt: string;
  hash: string;
  createdAt: string;
  linkedTags?: string[];
}

export interface SessionRecord {
  email: string;
  createdAt: string;
}

export const PBKDF2_ITERATIONS = 100_000;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" }, material, 256);
  return new Uint8Array(bits);
}

export async function registerUser(store: AuthStore, email: string, password: string, iterations = PBKDF2_ITERATIONS) {
  const normalized = normalizeEmail(email);
  const key = `user:${normalized}`;
  if (await store.get<UserRecord>(key, "json")) throw new Error("An account with that email already exists");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt, iterations);
  const record: UserRecord = { email: normalized, salt: encode(salt), hash: encode(hash), createdAt: new Date().toISOString(), linkedTags: [] };
  await store.put(key, JSON.stringify(record));
  return record;
}

export async function linkUserTag(store: AuthStore, email: string, tag: string) {
  const key = `user:${normalizeEmail(email)}`;
  const record = await store.get<UserRecord>(key, "json");
  if (!record) throw new Error("Account not found");
  const linkedTags = [...new Set([...(record.linkedTags ?? []), tag])];
  if (linkedTags.length > 5) throw new Error("A maximum of 5 linked accounts is allowed");
  await store.put(key, JSON.stringify({ ...record, linkedTags }));
  return linkedTags;
}

export async function unlinkUserTag(store: AuthStore, email: string, tag: string) {
  const key = `user:${normalizeEmail(email)}`;
  const record = await store.get<UserRecord>(key, "json");
  if (!record) throw new Error("Account not found");
  const linkedTags = (record.linkedTags ?? []).filter((value) => value !== tag);
  await store.put(key, JSON.stringify({ ...record, linkedTags }));
  return linkedTags;
}

export async function authenticateUser(store: AuthStore, email: string, password: string, iterations = PBKDF2_ITERATIONS) {
  const normalized = normalizeEmail(email);
  const record = await store.get<UserRecord>(`user:${normalized}`, "json");
  if (!record) return false;
  const actual = await hashPassword(password, decode(record.salt), iterations);
  return constantTimeEqual(actual, decode(record.hash));
}

export async function createSession(store: AuthStore, email: string) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  await store.put(`session:${token}`, JSON.stringify({ email: normalizeEmail(email), createdAt: new Date().toISOString() } satisfies SessionRecord), { expirationTtl: 60 * 60 * 24 * 30 });
  return token;
}

export async function sessionEmail(store: AuthStore, token: string) {
  if (!token) return null;
  const record = await store.get<SessionRecord>(`session:${token}`, "json");
  return record?.email ?? null;
}

export async function destroySession(store: AuthStore, token: string) {
  if (token) await store.delete(`session:${token}`);
}

export function bearerToken(request: Request) {
  const value = request.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left[index % (left.length || 1)] ?? 0) ^ (right[index % (right.length || 1)] ?? 0);
  return difference === 0;
}

function encode(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}

function decode(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
