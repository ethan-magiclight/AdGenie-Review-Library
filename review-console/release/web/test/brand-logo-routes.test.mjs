import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

process.env.VERCEL = "1";
const { handleRequest } = await import("../server.mjs");

async function request(url) {
  const result = { status: null, headers: null, body: null };
  await handleRequest({ method: "GET", url, headers: { host: "127.0.0.1" } }, {
    writeHead(status, headers) {
      result.status = status;
      result.headers = headers;
    },
    end(body) {
      result.body = body;
    },
  });
  return result;
}

test("serves candidate Logo downloads as internal preview with verified bytes", async () => {
  const response = await request("/brand-logos/nike.png?download=1");
  assert.equal(response.status, 200);
  assert.equal(response.headers["X-AdGenie-Asset-Scope"], "internal_preview");
  assert.equal(response.headers["Content-Disposition"], 'attachment; filename="nike.png"');
  assert.equal(response.headers["Content-Length"], String(response.body.length));
  assert.equal(response.headers.ETag, `"${crypto.createHash("sha256").update(response.body).digest("hex")}"`);
});

test("returns 404 for unapproved release and permission-blocked preview routes", async () => {
  assert.equal((await request("/brand-logos-release/nike.png")).status, 404);
  assert.equal((await request("/brand-logos/kfc.png")).status, 404);
});
