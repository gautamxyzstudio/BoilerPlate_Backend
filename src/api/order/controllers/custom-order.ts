import type { Context } from "koa";

export default {

    async getOrderStats(ctx: Context) {
        try {
            const statuses = [
                "pending",
                "processing",
                "delivery_assigned",
                "out_for_delivery",
            ] as const;

            const stats: Record<(typeof statuses)[number], number> = {
                pending: 0,
                processing: 0,
                delivery_assigned: 0,
                out_for_delivery: 0,
            };

            for (const status of statuses) {
                const orders = await strapi.db
                    .query("api::order.order")
                    .findMany({
                        where: {
                            orderStatus: status,
                        },
                        select: ["id"],
                    });

                stats[status] = orders.length;
            }

            return ctx.send(
                {
                    pending: stats.pending,
                    processing: stats.processing,
                    delivery_assigned: stats.delivery_assigned,
                    out_for_delivery: stats.out_for_delivery,
                },
            );
        } catch (error) {
            console.error("Get order stats error:", error);

            return ctx.internalServerError(
                "Something went wrong while fetching order statistics.",
            );
        }
    }

}