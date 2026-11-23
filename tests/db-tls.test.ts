import test from "node:test";
import assert from "node:assert/strict";
import { databaseSsl, withoutSslParams } from "../src/lib/db";

/**
 * Supabase's pooler is signed by Supabase's own CA. When DATABASE_SSL_CA is
 * present the URL must stop carrying sslmode, because node-postgres maps
 * `require` to verify-full and would override the CA we configured.
 */

test("ssl query parameters are removed before an explicit ssl object is used", () => {
  const stripped = withoutSslParams(
    "postgresql://user:pw@host:6543/postgres?sslmode=require&uselibpqcompat=true&application_name=bgd26",
  );
  const url = new URL(stripped);
  assert.equal(url.searchParams.get("sslmode"), null);
  assert.equal(url.searchParams.get("uselibpqcompat"), null);
  assert.equal(url.searchParams.get("application_name"), "bgd26");
  assert.equal(url.host, "host:6543");
  assert.equal(url.password, "pw");
});

test("DATABASE_SSL_CA enables verify-full and accepts escaped newlines", () => {
  const previous = process.env.DATABASE_SSL_CA;
  try {
    delete process.env.DATABASE_SSL_CA;
    assert.equal(databaseSsl(), undefined);

    process.env.DATABASE_SSL_CA = "-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----";
    const ssl = databaseSsl();
    assert.ok(ssl);
    assert.equal(ssl.rejectUnauthorized, true);
    assert.match(ssl.ca, /^-----BEGIN CERTIFICATE-----\nMIIB\n/);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_SSL_CA;
    else process.env.DATABASE_SSL_CA = previous;
  }
});
