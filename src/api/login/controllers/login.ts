import bcrypt from "bcryptjs";
import { normalizeIdentifier } from "../../../utils/normalizeIdentifier";
import type { Context } from "koa";

export default {
  async login(ctx: Context) {
    try {
      const body = ctx.request.body?.data || ctx.request.body;
      const { identifier, password } = body;

      if (!identifier || !password) {
        return ctx.badRequest(
          "Identifier and password are required."
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
        identifierType,
      } = normalized;

      // Find user
      const user = await strapi.db
        .query("plugin::users-permissions.user")
        .findOne({
          where:
            identifierType === "email"
              ? { email: normalizedIdentifier }
              : { phoneNumber: normalizedIdentifier },
          populate: {
            role: true,
          },
        });

      if (!user) {
        return ctx.badRequest("user not found");
      }

      if (user.blocked) {
        return ctx.badRequest(
          "Your account has been blocked."
        );
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(
        password,
        user.password
      );

      if (!isPasswordValid) {
        return ctx.badRequest("Invalid email or password.");
      }

      // Generate JWT
      const jwt = await strapi
        .plugin("users-permissions")
        .service("jwt")
        .issue({
          id: user.id,
        });

      // Return response
      return ctx.send({
        jwt,
        user,
      });
    } catch (error) {
      strapi.log.error("Login Error:", error);

      return ctx.internalServerError(
        "Login failed."
      );
    }
  },
};