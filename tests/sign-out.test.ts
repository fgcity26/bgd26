import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_SIGNED_OUT_PATH,
  STAFF_SIGNED_OUT_PATH,
  isSignedOutNotice,
} from "../src/lib/auth/sign-out";

/**
 * Regression guard for a reported bug: signing out dropped the visitor on the
 * storefront home page, with no sign that the session had ended.
 *
 * Both audiences must land on a sign-in screen, and the pages must recognise
 * the flag so they never bounce back to the console.
 */
test("sign-out sends each audience to its sign-in screen", () => {
  assert.equal(STAFF_SIGNED_OUT_PATH, "/login?signedOut=1");
  assert.equal(CUSTOMER_SIGNED_OUT_PATH, "/account/login?signedOut=1");

  assert.ok(STAFF_SIGNED_OUT_PATH.startsWith("/login"), "staff sign-out must end at /login");
  assert.ok(
    CUSTOMER_SIGNED_OUT_PATH.startsWith("/account/login"),
    "customer sign-out must end at /account/login",
  );

  // The shop home page was the bug. Neither target may be the storefront.
  for (const path of [STAFF_SIGNED_OUT_PATH, CUSTOMER_SIGNED_OUT_PATH]) {
    assert.notEqual(new URL(path, "https://bgd26.test").pathname, "/");
  }
});

test("the signed-out flag is read strictly", () => {
  assert.equal(isSignedOutNotice("1"), true);
  assert.equal(isSignedOutNotice("0"), false);
  assert.equal(isSignedOutNotice("true"), false);
  assert.equal(isSignedOutNotice(""), false);
  assert.equal(isSignedOutNotice(undefined), false);
  assert.equal(isSignedOutNotice(null), false);
});
