import type {Context} from "koa";

export default {

async getOrderStats(ctx: Context) {
    try {
        const statuses = [
            "pending",
            "processing",
            "ready_for_delivery",
            "out_for_delivery",
        ] as const;

        const stats: Record<(typeof statuses)[number], number> = {
            pending: 0,
            processing: 0,
            ready_for_delivery: 0,
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

        const total =
            stats.pending +
            stats.processing +
            stats.ready_for_delivery +
            stats.out_for_delivery;

        return ctx.send({
            data: {
                pending: stats.pending,
                processing: stats.processing,
                ready_for_delivery: stats.ready_for_delivery,
                out_for_delivery: stats.out_for_delivery,
                total,
            },
        });
    } catch (error) {
        console.error("Get order stats error:", error);

        return ctx.internalServerError(
            "Something went wrong while fetching order statistics.",
        );
    }
}

}