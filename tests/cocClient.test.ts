import { describe, expect, it, vi } from "vitest";
import { CocApiError, CocClient } from "../src/cocClient";

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("CocClient", () => {
  it("sends bearer auth and URL-encodes player tags", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { tag: "#2ABC", townHallLevel: 18 }));
    const client = new CocClient({ apiKey: "secret", fetcher });
    await client.getPlayer("#2ABC");
    expect(fetcher).toHaveBeenCalledWith(
      "https://cocproxy.royaleapi.dev/v1/players/%232ABC",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret" }) }),
    );
  });

  it("uses an explicit API base URL override", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { tag: "#2ABC" }));
    const client = new CocClient({ apiKey: "secret", baseUrl: "https://api.example.test/v1/", fetcher });
    await client.getPlayer("#2ABC");
    expect(fetcher).toHaveBeenCalledWith("https://api.example.test/v1/players/%232ABC", expect.anything());
  });

  it("honors Retry-After before retrying 429", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(429, { reason: "rateLimit" }, { "Retry-After": "2" }))
      .mockResolvedValueOnce(response(200, { tag: "#2ABC" }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new CocClient({ apiKey: "secret", fetcher, sleep, random: () => 0 });
    await client.getPlayer("#2ABC");
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("maps 503 to maintenance after retries", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(503, { reason: "maintenance" }));
    const client = new CocClient({ apiKey: "secret", fetcher, sleep: vi.fn().mockResolvedValue(undefined) });
    await expect(client.getPlayer("#2ABC")).rejects.toMatchObject({ code: "maintenance", status: 503 } satisfies Partial<CocApiError>);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
