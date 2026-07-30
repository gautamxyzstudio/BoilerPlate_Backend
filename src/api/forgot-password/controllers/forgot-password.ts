import { normalizeIdentifier } from "../../../utils/normalizeIdentifier";
import { sendEmailOtp } from "../../../utils/sendEmailOtp";
import { sendSmsOtp } from "../../../utils/sendSmsOtp";
import { encrypt } from "../../../utils/encryption";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { Context } from "koa";


const OTP_EXPIRY_MINUTES = 3;
const RESET_PASSWORD_EXPIRY_MINUTES = 10;

const generateOtp = () =>
    Math.floor(100000 + Math.random() * 900000).toString();

export default {

    async forgotPassword(ctx: Context) {
        try {
            const body = ctx.request.body?.data || ctx.request.body;

            const { identifier } = body;

            if (!identifier) {
                return ctx.badRequest("Identifier is required.");
            }

            // Normalize email / phone
            const normalized = normalizeIdentifier(identifier);

            if (!normalized) {
                return ctx.badRequest(
                    "Please enter a valid email or phone number."
                );
            }

            const {
                identifier: normalizedIdentifier,
                identifierType,
            } = normalized;

            // Check existing user
            const existingUser = await strapi.db
                .query("plugin::users-permissions.user")
                .findOne({
                    where:
                        identifierType === "email"
                            ? {
                                email: normalizedIdentifier,
                            }
                            : {
                                phoneNumber: normalizedIdentifier,
                            },
                });

            if (!existingUser) {
                return ctx.badRequest("User not found.");
            }

            // Generate OTP
            const otp = generateOtp();
            const otpHash = await bcrypt.hash(otp, 10);

            // Generate reset token
            const resetToken = crypto.randomUUID();

            // Delete expired reset sessions
            await strapi.db
                .query(
                    "api::reset-password-session.reset-password-session"
                )
                .deleteMany({
                    where: {
                        resetExpiresAt: {
                            $lt: new Date(),
                        },
                    },
                });

            // Check existing reset session
            const existingSession = await strapi.db
                .query(
                    "api::reset-password-session.reset-password-session"
                )
                .findOne({
                    where: {
                        identifier: normalizedIdentifier,
                    },
                });

            const data = {
                identifier: normalizedIdentifier,
                identifierType,
                resetToken,
                otpHash,
                otpExpiresAt: new Date(
                    Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
                ),
                resetExpiresAt: new Date(
                    Date.now() + RESET_PASSWORD_EXPIRY_MINUTES * 60 * 1000
                ),
                attempts: 0,
                verified: false,
                lastSentAt: new Date(),
            };

            if (existingSession) {
                await strapi.entityService.update(
                    "api::reset-password-session.reset-password-session",
                    existingSession.id,
                    {
                        data,
                    }
                );
            } else {
                await strapi.entityService.create(
                    "api::reset-password-session.reset-password-session",
                    {
                        data: {
                            ...data,
                            publishedAt: new Date(),
                        },
                    }
                );
            }

            // Send OTP
            if (identifierType === "email") {
                await sendEmailOtp(
                    normalizedIdentifier,
                    otp,
                    "Reset Password OTP",
                    "Reset Your Password",
                    "Use the OTP below to reset your password:"
                );
            } else {
                await sendSmsOtp(
                    normalizedIdentifier,
                    otp,
                    "Your password reset OTP is"
                );
            }

            return ctx.send({
                success: true,
                message: "OTP sent successfully.",
                resetToken,
            });
        } catch (error) {
            strapi.log.error("Forgot Password Error:", error);

            return ctx.internalServerError(
                "Failed to send OTP."
            );
        }
    },

    async verifyResetOtp(ctx: Context) {
        try {
            const body = ctx.request.body?.data || ctx.request.body;

            const { identifier, resetToken, otp } = body;

            if (!identifier || !resetToken || !otp) {
                return ctx.badRequest(
                    "Identifier, resetToken and OTP are required."
                );
            }

            // Normalize identifier
            const normalized = normalizeIdentifier(identifier);

            if (!normalized) {
                return ctx.badRequest(
                    "Please enter a valid email or phone number."
                );
            }

            const {
                identifier: normalizedIdentifier,
            } = normalized;

            // Find reset session
            const resetSession = await strapi.db
                .query(
                    "api::reset-password-session.reset-password-session"
                )
                .findOne({
                    where: {
                        identifier: normalizedIdentifier,
                        resetToken,
                    },
                });

            if (!resetSession) {
                return ctx.badRequest(
                    "Invalid reset password session."
                );
            }

            // Check reset session expiry
            if (
                new Date(resetSession.resetExpiresAt).getTime() <
                Date.now()
            ) {
                await strapi.entityService.delete(
                    "api::reset-password-session.reset-password-session",
                    resetSession.id
                );

                return ctx.badRequest(
                    "Reset password session has expired. Please request a new OTP."
                );
            }

            // Check OTP expiry
            if (
                new Date(resetSession.otpExpiresAt).getTime() <
                Date.now()
            ) {
                return ctx.badRequest(
                    "OTP has expired. Please resend OTP."
                );
            }

            // Maximum attempts
            if (resetSession.attempts >= 5) {
                return ctx.badRequest(
                    "Maximum OTP attempts exceeded. Please request a new OTP."
                );
            }

            // Verify OTP
            const isOtpValid = await bcrypt.compare(
                otp,
                resetSession.otpHash
            );

            if (!isOtpValid) {
                await strapi.entityService.update(
                    "api::reset-password-session.reset-password-session",
                    resetSession.id,
                    {
                        data: {
                            attempts: resetSession.attempts + 1,
                        },
                    }
                );

                return ctx.badRequest("Invalid OTP.");
            }

            // Mark session as verified
            await strapi.entityService.update(
                "api::reset-password-session.reset-password-session",
                resetSession.id,
                {
                    data: {
                        verified: true,
                        attempts: 0,
                    },
                }
            );

            return ctx.send({
                success: true,
                message: "OTP verified successfully.",
                resetToken,
            });
        } catch (error) {
            strapi.log.error(
                "Verify Reset OTP Error:",
                error
            );

            return ctx.internalServerError(
                "OTP verification failed."
            );
        }
    },

    async resetPassword(ctx: Context) {
        try {
            const body = ctx.request.body?.data || ctx.request.body;

            const {
                identifier,
                resetToken,
                password,
            } = body;

            if (
                !identifier ||
                !resetToken ||
                !password
            ) {
                return ctx.badRequest(
                    "Identifier, resetToken and password are required."
                );
            }

            // Normalize identifier
            const normalized = normalizeIdentifier(identifier);

            if (!normalized) {
                return ctx.badRequest(
                    "Please enter a valid email or phone number."
                );
            }

            const {
                identifier: normalizedIdentifier,
                identifierType,
            } = normalized;

            // Find reset session
            const resetSession = await strapi.db
                .query(
                    "api::reset-password-session.reset-password-session"
                )
                .findOne({
                    where: {
                        identifier: normalizedIdentifier,
                        resetToken,
                    },
                });

            if (!resetSession) {
                return ctx.badRequest(
                    "Invalid reset password session."
                );
            }

            // Check session expiry
            if (
                new Date(resetSession.resetExpiresAt).getTime() <
                Date.now()
            ) {
                await strapi.entityService.delete(
                    "api::reset-password-session.reset-password-session",
                    resetSession.id
                );

                return ctx.badRequest(
                    "Reset password session has expired."
                );
            }

            if (!resetSession.verified) {
                return ctx.badRequest(
                    "OTP verification required."
                );
            }

            // Find user
            const user = await strapi.db
                .query("plugin::users-permissions.user")
                .findOne({
                    where:
                        identifierType === "email"
                            ? {
                                email: normalizedIdentifier,
                            }
                            : {
                                phoneNumber: normalizedIdentifier,
                            },
                });

            if (!user) {
                return ctx.badRequest("User not found.");
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(
                password,
                10
            );

            // Update Strapi password
            await strapi.db
                .query("plugin::users-permissions.user")
                .update({
                    where: {
                        id: user.id,
                    },
                    data: {
                        password: hashedPassword,
                    },
                });

            /**
             * Update Cognito password here if applicable.
             *
             * Example:
             *
             * await adminSetUserPassword(
             *    user.username,
             *    password
             * );
             */

            // Delete reset session
            await strapi.entityService.delete(
                "api::reset-password-session.reset-password-session",
                resetSession.id
            );

            return ctx.send({
                success: true,
                message: "Password reset successfully.",
            });
        } catch (error) {
            strapi.log.error(
                "Reset Password Error:",
                error
            );

            return ctx.internalServerError(
                "Password reset failed."
            );
        }
    },

    async resendResetOtp(ctx: Context) {
        try {
            const body = ctx.request.body?.data || ctx.request.body;

            const { identifier, resetToken } = body;

            if (!identifier || !resetToken) {
                return ctx.badRequest(
                    "Identifier and resetToken are required."
                );
            }

            // Normalize email / phone
            const normalized = normalizeIdentifier(identifier);

            if (!normalized) {
                return ctx.badRequest(
                    "Please enter a valid email or phone number."
                );
            }

            const {
                identifier: normalizedIdentifier,
                identifierType,
            } = normalized;

            // Find reset session
            const resetSession = await strapi.db
                .query(
                    "api::reset-password-session.reset-password-session"
                )
                .findOne({
                    where: {
                        identifier: normalizedIdentifier,
                        resetToken,
                    },
                });

            if (!resetSession) {
                return ctx.badRequest(
                    "Invalid reset password session."
                );
            }

            // Check session expiry
            if (
                new Date(resetSession.resetExpiresAt).getTime() <
                Date.now()
            ) {
                await strapi.entityService.delete(
                    "api::reset-password-session.reset-password-session",
                    resetSession.id
                );

                return ctx.badRequest(
                    "Reset password session has expired. Please request forgot password again."
                );
            }

            // Generate new OTP
            const otp = generateOtp();
            const otpHash = await bcrypt.hash(otp, 10);

            await strapi.entityService.update(
                "api::reset-password-session.reset-password-session",
                resetSession.id,
                {
                    data: {
                        otpHash,
                        otpExpiresAt: new Date(
                            Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
                        ),
                        attempts: 0,
                        verified: false,
                        lastSentAt: new Date(),
                        publishedAt: new Date(),
                    },
                }
            );

            // Send OTP
            if (identifierType === "email") {
                await sendEmailOtp(
                    normalizedIdentifier,
                    otp,
                    "Reset Password OTP",
                    "Reset Your Password",
                    "Use the OTP below to reset your password:"
                );
            } else {
                await sendSmsOtp(
                    normalizedIdentifier,
                    otp,
                    "Your password reset OTP is"
                );
            }

            return ctx.send({
                success: true,
                message: "OTP resent successfully.",
                resetToken,
            });
        } catch (error) {
            strapi.log.error(
                "Resend Reset OTP Error:",
                error
            );

            return ctx.internalServerError(
                "Failed to resend OTP."
            );
        }
    }

}