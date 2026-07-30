import axios from "axios";

export const sendEmailOtp = async (
  email: string,
  otp: string,
  subject = "Email Verification OTP",
  title = "Email Verification",
  message = "Your OTP is:"
): Promise<void> => {
  try {
    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "BoilerPlate",
          email: process.env.BREVO_EMAIL_SENDER,
        },
        to: [
          {
            email,
          },
        ],
        subject,
        htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
            <h2>${title}</h2>

            <p>${message}</p>

            <h1 style="
                letter-spacing:5px;
                background:#f4f4f4;
                padding:15px;
                display:inline-block;
                border-radius:6px;
            ">
                ${otp}
            </h1>

            <p>This OTP is valid for 3 minutes.</p>

            <p>If you didn't request this, please ignore this email.</p>
        </div>
        `,
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error("BREVO STATUS:", error.response?.status);
    console.error("BREVO DATA:", error.response?.data);

    throw new Error("Failed to send email OTP.");
  }
};