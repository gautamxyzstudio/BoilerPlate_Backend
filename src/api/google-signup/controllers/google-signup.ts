"use strict";

const { OAuth2Client } = require("google-auth-library");
import crypto from "crypto";
import type { Context } from "koa"

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export default {

  async googleSignup(ctx: Context) {
    try {
      const { idToken } = ctx.request.body;

      if (!idToken) {
        return ctx.badRequest("Google idToken is required.");
      }

      /* ================= VERIFY GOOGLE TOKEN ================= */

      const ticket = await client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();

      if (!payload || !payload.email) {
        return ctx.badRequest("Invalid Google token.");
      }

      const email = payload.email.toLowerCase();

      /* ================= FIND EXISTING USER ================= */

      let user = await strapi.db
        .query("plugin::users-permissions.user")
        .findOne({
          where: { email },
          populate: ["role"],
        });

      /* ================= CREATE USER IF NOT EXISTS ================= */

      if (!user) {
        const customerRole = await strapi.db
          .query("plugin::users-permissions.role")
          .findOne({
            where: {
              name: "Customer",
            },
          });

        if (!customerRole) {
          return ctx.internalServerError("Customer role not found.");
        }

        const generatedPassword = crypto.randomBytes(16).toString("hex");

        user = await strapi.entityService.create(
          "plugin::users-permissions.user",
          {
            data: {
              username: email,
              email,
              password: generatedPassword,
              role: customerRole.id,
              provider: "local",
              confirmed: true,
            },
            populate: ["role"],
          }
        );
      }

      /* ================= GENERATE JWT ================= */

      const jwt = await strapi
        .plugin("users-permissions")
        .service("jwt")
        .issue({
          id: user.id,
        });

      /* ================= RESPONSE ================= */

      return ctx.send({
        jwt,
        user,
      });
    } catch (err) {
      console.error("GOOGLE AUTH ERROR:", err);

      return ctx.internalServerError("Google authentication failed.");
    }
  },
};