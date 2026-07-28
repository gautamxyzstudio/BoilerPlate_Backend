import axios from "axios";

export const sendEmailOtp = async (
  email: string,
  otp: string
): Promise<void> => {
  try {
    // console.log("API KEY",process.env.BREVO_API_KEY)
    // console.log("sender",process.env.BREVO_EMAIL_SENDER)
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
        subject: "Email Verification OTP",
        htmlContent: `
        <div style="font-family:Arial,sans-serif">
            <h2>Email Verification</h2>

            <p>Your OTP is:</p>

            <h1 style="letter-spacing:5px">${otp}</h1>

            <p>This OTP is valid for 2 minutes.</p>

            <p>If you didn't request this, ignore this email.</p>
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
  }  catch (error: any) {
  console.error("BREVO STATUS:", error.response?.status);
  console.error("BREVO DATA:", error.response?.data);

  throw new Error("Failed to send email OTP.");
}
};