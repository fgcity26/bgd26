import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * Password and manager-PIN hashing.
 *
 * scrypt is built into Node, needs no native dependency, and is memory-hard.
 * The encoded string carries its own parameters so the cost can be raised
 * later without invalidating existing hashes.
 *
 * Format: scrypt$N$r$p$<salt-base64url>$<hash-base64url>
 */
const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(secret.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
  });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifySecret(secret: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const salt = Buffer.from(saltRaw, "base64url");
  const expected = Buffer.from(hashRaw, "base64url");

  const derived = await scrypt(secret.normalize("NFKC"), salt, expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Six digits, no leading-zero ambiguity for staff typing. */
export function isValidManagerPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

/**
 * Manager PINs are only six digits, so a stored hash alone can be brute-forced
 * offline in seconds. The pepper lives in the environment (never in the
 * database), which makes a stolen dump useless on its own.
 */
export function pinPepper(): string {
  const pepper = process.env.MANAGER_PIN_PEPPER?.trim();
  if (pepper && pepper.length >= 16) return pepper;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MANAGER_PIN_PEPPER must be set to at least 16 characters in production. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  return "bgd26-development-pin-pepper";
}

export async function hashPin(pin: string): Promise<string> {
  if (!isValidManagerPin(pin)) {
    throw new Error("A manager PIN must be exactly six digits.");
  }
  return hashSecret(`pin:${pin}:${pinPepper()}`);
}

export async function verifyPin(pin: string, encoded: string): Promise<boolean> {
  if (!isValidManagerPin(pin)) return false;
  return verifySecret(`pin:${pin}:${pinPepper()}`, encoded);
}
