import { factories } from "@strapi/strapi";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { encrypt } from "../../../utils/encryption";
import { sendEmailOtp } from "../../../utils/sendEmailOtp";
import { sendSmsOtp } from "../../../utils/sendSmsOtp";
import { decrypt } from "../../../utils/encryption";
import { normalizeIdentifier } from "../../../utils/normalizeIdentifier";

const OTP_EXPIRY_MINUTES = 3;
const SIGNUP_EXPIRY_MINUTES = 10;

const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

export default factories.createCoreController(
  "api::pending-signup.pending-signup",
  ({ strapi }) => ({

    async signup(ctx) {
      try {
        const body = ctx.request.body?.data || ctx.request.body;

        const { identifier, password, role } = body;

        if (!identifier || !password || !role) {
          return ctx.badRequest(
            "Identifier, password and role are required."
          );
        }

        const allowedRoles = ["Customer", "Admin"];

        if (!allowedRoles.includes(role)) {
          return ctx.badRequest("Invalid role.");
        }

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
                ? { email: normalizedIdentifier }
                : { phoneNumber: normalizedIdentifier },
          });

        if (existingUser) {
          return ctx.badRequest(
            "User already exists. Please login."
          );
        }

        // Generate OTP
        const otp = generateOtp();
        const otpHash = await bcrypt.hash(otp, 10);

        // Encrypt password
        const encryptedPassword = encrypt(password);

        // Generate signup token
        const signupToken = crypto.randomUUID();

        // Delete expired signup sessions
        await strapi.db
          .query("api::pending-signup.pending-signup")
          .deleteMany({
            where: {
              signupExpiresAt: {
                $lt: new Date(),
              },
            },
          });

        // Check existing pending signup
        const pendingSignup = await strapi.db
          .query("api::pending-signup.pending-signup")
          .findOne({
            where: {
              identifier: normalizedIdentifier,
            },
          });

        const data = {
          identifier: normalizedIdentifier,
          identifierType,
          password: encryptedPassword,
          role,
          signupToken,
          otpHash,
          otpExpiresAt: new Date(
            Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
          ),
          signupExpiresAt: new Date(
            Date.now() + SIGNUP_EXPIRY_MINUTES * 60 * 1000
          ),
          attempts: 0,
          verified: false,
          lastSentAt: new Date(),
        };

        if (pendingSignup) {
          await strapi.entityService.update(
            "api::pending-signup.pending-signup" as any,
            pendingSignup.id,
            {
              data,
            }
          );
        } else {
          await strapi.entityService.create(
            "api::pending-signup.pending-signup" as any,
            {
              data,
            }
          );
        }

        // Send OTP
        if (identifierType === "email") {
          await sendEmailOtp(normalizedIdentifier, otp);
        } else {
          await sendSmsOtp(normalizedIdentifier, otp);
        }

        return ctx.send({
          success: true,
          message: "OTP sent successfully.",
          signupToken,
        });
      } catch (error) {
        strapi.log.error("Signup Error:", error);

        return ctx.internalServerError(
          "Registration failed."
        );
      }
    },

    async verifyOtp(ctx) {
      try {
        const body = ctx.request.body?.data || ctx.request.body;

        const { identifier, signupToken, otp } = body;

        if (!identifier || !signupToken || !otp) {
          return ctx.badRequest(
            "Identifier, signupToken and OTP are required."
          );
        }

        const normalized = normalizeIdentifier(identifier);

        if (!normalized) {
          return ctx.badRequest(
            "Please enter a valid email or phone number."
          );
        }

        const {
          identifier: normalizedIdentifier,
        } = normalized;

        // Find pending signup
        const pendingSignup = await strapi.db
          .query("api::pending-signup.pending-signup")
          .findOne({
            where: {
              identifier: normalizedIdentifier,
              signupToken,
            },
          });

        if (!pendingSignup) {
          return ctx.badRequest(
            "Invalid signup session."
          );
        }

        // Check signup expiry
        if (
          new Date(pendingSignup.signupExpiresAt).getTime() <
          Date.now()
        ) {
          await strapi.entityService.delete(
            "api::pending-signup.pending-signup" as any,
            pendingSignup.id
          );

          return ctx.badRequest(
            "Signup session has expired. Please register again."
          );
        }

        // Check OTP expiry
        if (
          new Date(pendingSignup.otpExpiresAt).getTime() <
          Date.now()
        ) {
          return ctx.badRequest(
            "OTP has expired, resend otp."
          );
        }

        // Max attempts
        if (pendingSignup.attempts >= 5) {
          return ctx.badRequest(
            "Maximum OTP attempts exceeded. Please request a new OTP."
          );
        }

        // Verify OTP
        const isOtpValid = await bcrypt.compare(
          otp,
          pendingSignup.otpHash
        );

        if (!isOtpValid) {
          await strapi.entityService.update(
            "api::pending-signup.pending-signup" as any,
            pendingSignup.id,
            {
              data: {
                attempts: pendingSignup.attempts + 1,
              } as any,
            }
          );

          return ctx.badRequest("Invalid OTP.");
        }

        // Decrypt password
        const password = decrypt(
          pendingSignup.password
        );

        // Find role
        const role = await strapi.db
          .query("plugin::users-permissions.role")
          .findOne({
            where: {
              name: pendingSignup.role,
            },
          });

        if (!role) {
          return ctx.badRequest("Invalid role configured.");
        }

        // Prepare user data
        const userData: any = {
          username: pendingSignup.identifier,
          password,
          role: role.id,
          confirmed: true,
          blocked: false,
        };

        if (pendingSignup.identifierType === "email") {
          userData.email = pendingSignup.identifier;
        } else {
          userData.phoneNumber = pendingSignup.identifier;
        }


        // Create Strapi user
        const user = await strapi.entityService.create(
          "plugin::users-permissions.user",
          {
            data: userData,
            populate: ["role"],
          } as any
        );

        // Generate JWT
        const jwt = await strapi
          .plugin("users-permissions")
          .service("jwt")
          .issue({
            id: user.id,
          });

        // Delete pending signup
        await strapi.entityService.delete(
          "api::pending-signup.pending-signup" as any,
          pendingSignup.id
        );

        // Return response
        return ctx.send({
          success: true,
          jwt,
          user,
        });
      } catch (error) {
        strapi.log.error("Verify OTP Error:", error);

        return ctx.internalServerError(
          "OTP verification failed."
        );
      }
    },

    async resendOtp(ctx) {
      try {
        const body = ctx.request.body?.data || ctx.request.body;

        const { identifier, signupToken } = body;

        if (!identifier || !signupToken) {
          return ctx.badRequest(
            "Identifier and signupToken are required."
          );
        }

        const normalized = normalizeIdentifier(identifier);

        if (!normalized) {
          return ctx.badRequest(
            "Please enter a valid email or phone number."
          );
        }

        const { identifier: normalizedIdentifier } = normalized;

        const pendingSignup = await strapi.db
          .query("api::pending-signup.pending-signup")
          .findOne({
            where: {
              identifier: normalizedIdentifier,
              signupToken,
            },
          });

        if (!pendingSignup) {
          return ctx.badRequest("Invalid signup session.");
        }

        // Check signup expiry
        if (
          new Date(pendingSignup.signupExpiresAt).getTime() <
          Date.now()
        ) {
          await strapi.entityService.delete(
            "api::pending-signup.pending-signup" as any,
            pendingSignup.id
          );

          return ctx.badRequest(
            "Signup session has expired. Please register again."
          );
        }

        // Generate new OTP
        const otp = crypto.randomInt(100000, 999999).toString();

        const otpHash = await bcrypt.hash(otp, 10);

        const otpExpiresAt = new Date(
          Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
        );

        await strapi.entityService.update(
          "api::pending-signup.pending-signup" as any,
          pendingSignup.id,
          {
            data: {
              otpHash,
              otpExpiresAt,
              attempts: 0,
              lastSentAt: new Date(),
            } as any,
          }
        );

        // Send OTP
        if (pendingSignup.identifierType === "email") {
          await sendEmailOtp(pendingSignup.identifier, otp);
        } else {
          await sendSmsOtp(pendingSignup.identifier, otp);
        }

        return ctx.send({
          success: true,
          message: "OTP resent successfully.",
          signupToken: pendingSignup.signupToken,
        });
      } catch (error) {
        strapi.log.error("Resend OTP Error:", error);

        return ctx.internalServerError(
          "Failed to resend OTP."
        );
      }
    }

  })
);