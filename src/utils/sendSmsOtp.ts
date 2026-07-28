import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export const sendSmsOtp = async (
  phone: string,
  otp: string
): Promise<void> => {
  try {
    await client.messages.create({
      body: `Your verification OTP is ${otp}. It is valid for 2 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });
  } catch (error) {
    strapi.log.error("TWILIO ERROR", error);
    throw new Error("Failed to send SMS OTP.");
  }
};