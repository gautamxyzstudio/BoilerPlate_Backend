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
                    });

                return ctx.send({
                    data: notifications,
                });
            } catch (error) {
                console.error(
                    "Find notifications error:",
                    error
                );

                return ctx.internalServerError(
                    "Something went wrong while fetching notifications."
                );
            }
        },
    })
);