export default {
    routes: [
        {
            method: "POST",
            path: "/forgot-password",
            handler: "forgot-password.forgotPassword",
            config: {
                auth: false,
            },
        },
        {
            method: "POST",
            path: "/verify-reset-otp",
            handler: "forgot-password.verifyResetOtp",
            config: {
                auth: false,
            },
        },
        {
            method: "POST",
            path: "/reset-password",
            handler: "forgot-password.resetPassword",
            config: {
                auth: false,
            },
        },
        {
            method: "POST",
            path: "/resend-reset-otp",
            handler: "forgot-password.resendResetOtp",
            config: {
                auth: false,
            },
        },
    ],
};