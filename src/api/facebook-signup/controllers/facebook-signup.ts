import axios from "axios";
import crypto from "crypto";
import type { Context } from "koa";

export default {
  async facebookSignup(ctx: Context) {
    try {
      const { accessToken } = ctx.request.body;

      if (!accessToken) {
        return ctx.badRequest("Facebook accessToken is required.");
      }

      /* ================= VERIFY FACEBOOK TOKEN ================= */

      const tokenResponse = await axios.get(
        "https://graph.facebook.com/debug_token",
        {
          params: {
            input_token: accessToken,
            access_token: `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`,
          },
        }
      );

      const tokenData = tokenResponse.data.data;

      if (!tokenData || !tokenData.is_valid) {
        return ctx.badRequest("Invalid Facebook token.");
      }

      if (tokenData.app_id !== process.env.FACEBOOK_APP_ID) {
        return ctx.badRequest("Token does not belong to this application.");
      }

      /* ================= GET USER INFO ================= */

      const userResponse = await axios.get(
        "https://graph.facebook.com/me",
        {
          params: {
            fields: "id,name,email",
            access_token: accessToken,
          },
        }
      );

      const facebookUser = userResponse.data;

      if (!facebookUser.email) {
        return ctx.badRequest(
          "Facebook account does not provide an email."
        );
      }

      const email = facebookUser.email.toLowerCase();

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
              provider: "facebook",
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
        success: true,
        jwt,
        user,
      });
    } catch (err: any) {
      console.error("FACEBOOK AUTH ERROR:", err.response?.data || err);

      return ctx.internalServerError(
        "Facebook authentication failed."
      );
    }
  },
};