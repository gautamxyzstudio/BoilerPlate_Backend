import type { Core } from "@strapi/strapi";

export default {
    deleteOldNotifications: {
        task: async ({ strapi }: { strapi: Core.Strapi }) => {
            try {
                const cutoffDate = new Date();

                cutoffDate.setDate(
                    cutoffDate.getDate() - 7
                );

                const oldNotifications = await strapi.db
                    .query("api::notification.notification")
                    .findMany({
                        where: {
                            createdAt: {
                                $lt: cutoffDate,
                            },
                        },
                        select: ["id", "documentId"],
                    });

                if (oldNotifications.length === 0) {
                    strapi.log.info(
                        "Notification cleanup: No old notifications found."
                    );

                    return;
                }

                const notificationIds =
                    oldNotifications.map(
                        (notification) => notification.id
                    );

                await strapi.db
                    .query(
                        "api::notification-reader.notification-reader"
                    )
                    .deleteMany({
                        where: {
                            notification: {
                                $in: notificationIds,
                            },
                        },
                    });

                const result = await strapi.db
                    .query("api::notification.notification")
                    .deleteMany({
                        where: {
                            id: {
                                $in: notificationIds,
                            },
                        },
                    });

                strapi.log.info(
                    `Notification cleanup: Deleted ${result.count} notifications older than 7 days.`
                );
            } catch (error) {
                strapi.log.error(
                    "Notification cleanup failed:",
                    error
                );
            }
        },

        options: {
            rule: "0 8 * * *",
            tz: "Asia/Kolkata",
        },
    },
};



