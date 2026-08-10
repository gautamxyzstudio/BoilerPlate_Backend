import { factories } from "@strapi/strapi";
import bcrypt from "bcryptjs";

export default factories.createCoreController(
  "plugin::users-permissions.user",
  ({ strapi }) => ({
    async changePassword(ctx) {
      try {
        const user = ctx.state.user;

        if (!user) {
          return ctx.unauthorized("You must be logged in.");
        }

        const { currentPassword, newPassword} =
          ctx.request.body;

        if (!currentPassword || !newPassword) {
          return ctx.badRequest(
            "Current password and new password password are required."
          );
        }

        if (currentPassword === newPassword) {
          return ctx.badRequest(
            "New password must be different from the current password."
          );
        }

        const dbUser = await strapi
          .query("plugin::users-permissions.user")
          .findOne({
            where: { id: user.id },
          });

        const isValidPassword = await bcrypt.compare(
          currentPassword,
          dbUser.password
        );

        if (!isValidPassword) {
          return ctx.badRequest("Current password is incorrect.");
        }

        await strapi
          .plugin("users-permissions")
          .service("user")
          .edit(user.id, {
            password: newPassword,
          });

        return ctx.send({
          message: "Password changed successfully.",
        });
      } catch (error) {
        strapi.log.error("Change Password Error:", error);
        return ctx.internalServerError("Something went wrong.");
      }
    },
  })
);