import crypto from "crypto";

const CHARACTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Generates a random 6-character uppercase alphanumeric payment ID code with "PAY-" prefix.
 * Example: "PAY-A8K92X", "PAY-7M2P9Q"
 * @param length Length of the random alphanumeric string after "PAY-" (default 6)
 */
export const generatePaymentIdCode = (length = 6): string => {
  let code = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += CHARACTERS[bytes[i] % CHARACTERS.length];
  }
  return `PAY-${code}`;
};

/**
 * Generates a unique paymentId with prefix "PAY-" and 6 random uppercase alphanumeric characters
 * checking against database to ensure uniqueness.
 * @param strapi Strapi instance
 */
export const generateUniquePaymentId = async (strapi: any): Promise<string> => {
  let paymentId = "";
  let exists = true;

  while (exists) {
    paymentId = generatePaymentIdCode(6);

    const existingRecord = await strapi.db
      .query("api::payment-collection.payment-collection")
      .findOne({
        where: { paymentId },
        select: ["id"],
      });

    exists = !!existingRecord;
  }

  return paymentId;
};

export default {
  generatePaymentIdCode,
  generateUniquePaymentId,
};
