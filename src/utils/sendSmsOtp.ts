import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export const sendSmsOtp = async (
  phone: string,
  otp: string,
  message = "Your verification OTP is"
): Promise<void> => {
  try {
    await client.messages.create({
      body: `${message} ${otp}. It is valid for 3 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });
  } catch (error) {
    strapi.log.error("TWILIO ERROR", error);
    throw new Error("Failed to send SMS OTP.");
  }
};