import crypto from "crypto";

const algorithm = "aes-256-cbc";

const getKey = () => {
  const secret = process.env.PASSWORD_SECRET;

  if (!secret) {
    throw new Error("PASSWORD_SECRET is missing in .env");
  }

  return crypto.createHash("sha256").update(secret).digest();
};

export const encrypt = (text: string): string => {
  const key = getKey();
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  return `${iv.toString("hex")}:${encrypted}`;
};

export const decrypt = (encryptedText: string): string => {
  const key = getKey();

  const [ivHex, encrypted] = encryptedText.split(":");

  const decipher = crypto.createDecipheriv(
    algorithm,
    key,
    Buffer.from(ivHex, "hex")
  );

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};