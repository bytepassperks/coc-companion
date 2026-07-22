import { describe, expect, it, vi } from "vitest";
import { authenticateUser, createSession, linkUserTag, registerUser, sessionEmail, unlinkUserTag, type AuthStore } from "../src/auth";

function store() {
  const values = new Map<string, string>();
  const result: AuthStore = {
    get: async <T>(key: string, _type: "json") => values.has(key) ? JSON.parse(values.get(key)!) as T : null,
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    delete: vi.fn(async (key: string) => { values.delete(key); }),
  };
  return result;
}

describe("app authentication", () => {
  it("stores salted PBKDF2 credentials and authenticates without plaintext", async () => {
    const kv = store();
    await registerUser(kv, " User@example.com ", "password123", 1_000);
    expect(await authenticateUser(kv, "user@example.com", "password123", 1_000)).toBe(true);
    expect(await authenticateUser(kv, "user@example.com", "wrongpass", 1_000)).toBe(false);
    const record = await kv.get("user:user@example.com", "json") as { email: string; salt: string; hash: string };
    expect(record.email).toBe("user@example.com");
    expect(record.salt).not.toBe("password123");
    expect(record.hash).not.toBe("password123");
  });

  it("creates and resolves a session token", async () => {
    const kv = store();
    const token = await createSession(kv, "user@example.com");
    expect(token).toMatch(/^[0-9a-f-]{72}$/);
    expect(await sessionEmail(kv, token)).toBe("user@example.com");
  });

  it("links and unlinks up to five account tags", async () => {
    const kv = store();
    await registerUser(kv, "user@example.com", "password123", 1_000);
    expect(await linkUserTag(kv, "user@example.com", "#2PYC")).toEqual(["#2PYC"]);
    expect(await linkUserTag(kv, "user@example.com", "#R2RV")).toEqual(["#2PYC", "#R2RV"]);
    expect(await unlinkUserTag(kv, "user@example.com", "#2PYC")).toEqual(["#R2RV"]);
  });
});
