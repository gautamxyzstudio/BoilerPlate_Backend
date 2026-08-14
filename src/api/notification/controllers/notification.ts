/**
 * notification controller
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreController(
  "api::notification.notification",
  ({ strapi }) => ({
    async find(ctx) {
      try {
        const notifications = await strapi
          .documents("api::notification.notification")
          .findMany({
            sort: {
              createdAt: "desc",
            },
            populate: {
              notification_readers: {
                populate: {
                  users_permissions_user: true,
                },
              },
            },
          });

        const formattedNotifications = notifications.map((n: any) => ({
          id: n.id,
          documentId: n.documentId,
          title: n.title,
          description: n.description,
          type: n.type,
          createdAt: n.createdAt,
          notification_readers: (n.notification_readers || []).map(
            (nr: any) => ({
              documentId: nr.documentId,
              users_permissions_user: nr.users_permissions_user
                ? {
                    documentId: nr.users_permissions_user.documentId,
                  }
                : null,
            }),
          ),
        }));

        return ctx.send({
          data: formattedNotifications,
        });
      } catch (error) {
        console.error("Find notifications error:", error);

        return ctx.internalServerError(
          "Something went wrong while fetching notifications.",
        );
      }
    },
  }),
);
