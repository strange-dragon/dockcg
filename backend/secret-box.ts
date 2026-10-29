import crypto from "crypto";

/**
 * Small AES-256-GCM helper used to keep registry credentials unreadable at rest.
 * The key is derived from the Dockcg instance JWT secret, which never leaves the data directory.
 */

const ALGORITHM = "aes-256-gcm";

function deriveKey(keyMaterial : string) : Buffer {
    return crypto.createHash("sha256").update(keyMaterial).digest();
}

/**
 * Encrypt a secret. Output format: iv:authTag:cipherText (base64).
 */
export function encryptSecret(plainText : string, keyMaterial : string) : string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(keyMaterial), iv);
    const encrypted = Buffer.concat([ cipher.update(plainText, "utf-8"), cipher.final() ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypt a secret produced by encryptSecret().
 */
export function decryptSecret(payload : string, keyMaterial : string) : string {
    const parts = payload.split(":");

    if (parts.length !== 3) {
        throw new Error("Invalid stored secret");
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(keyMaterial), Buffer.from(parts[0], "base64"));
    decipher.setAuthTag(Buffer.from(parts[1], "base64"));

    return Buffer.concat([
        decipher.update(Buffer.from(parts[2], "base64")),
        decipher.final(),
    ]).toString("utf-8");
}
