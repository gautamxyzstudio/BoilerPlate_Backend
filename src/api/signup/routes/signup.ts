export default {
  routes: [
    {
      method: "POST",
      path: "/auth/signup",
      handler: "signup.signup",
      config: {
        auth: false,
      },
    },
    {
      method: "POST",
      path: "/auth/verify-otp",
      handler: "signup.verifyOtp",
      config: {
        auth: false,
      },
    },
    {
      method: "POST",
      path: "/auth/resend-otp",
      handler: "signup.resendOtp",
      config: {
        auth: false,
      },
    },
  ],
};