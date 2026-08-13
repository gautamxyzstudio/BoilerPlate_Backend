import type { Context } from "koa";
import { getIO } from "../../../socket";

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
    },

    async orderServiceStats(ctx: Context) {
        try {
            // ============================================
            // Get all services
            // ============================================

            const services = await strapi.db
                .query("api::service.service")
                .findMany({
                    select: ["id", "name"],
                });

            // ============================================
            // Get all orders with order items + service
            // ============================================

            const orders = await strapi.db
                .query("api::order.order")
                .findMany({
                    populate: {
                        order_items: {
                            populate: {
                                service: true,
                            },
                        },
                    },
                });

            // ============================================
            // Initialize all services
            // ============================================

            const serviceCounts: Record<
                number,
                {
                    id: number;
                    name: string;
                    count: number;
                }
            > = {};

            for (const service of services) {
                serviceCounts[service.id] = {
                    id: service.id,
                    name: service.name,
                    count: 0,
                };
            }

            // ============================================
            // Count quantities service-wise
            // ============================================

            let totalItems = 0;

            for (const order of orders) {
                for (const item of order.order_items || []) {
                    if (!item.service) {
                        continue;
                    }

                    const serviceId = item.service.id;
                    const quantity = Number(item.quantity || 0);

                    // If service exists in the service list
                    if (serviceCounts[serviceId]) {
                        serviceCounts[serviceId].count += quantity;
                    } else {
                        // Fallback in case service is not found
                        serviceCounts[serviceId] = {
                            id: serviceId,
                            name: item.service.name,
                            count: quantity,
                        };
                    }

                    totalItems += quantity;
                }
            }

            // ============================================
            // Calculate percentage
            // ============================================

            const serviceStats = Object.values(serviceCounts).map((service) => ({
                name: service.name,
                count: service.count,
                percentage:
                    totalItems > 0
                        ? Number(((service.count / totalItems) * 100).toFixed(2))
                        : 0,
            }));

            // ============================================
            // Return response
            // ============================================

            return ctx.send({
                totalItems,
                services: serviceStats,
            });
        } catch (error) {
            console.error("Service stats error:", error);

            return ctx.internalServerError(
                "Unable to fetch service statistics."
            );
        }
    },

    async revenueTrends(ctx: Context) {
        try {
            // ============================================
            // Get today
            // ============================================

            const today = new Date();

            // ============================================
            // Start of today
            // ============================================

            const endDate = new Date(today);
            endDate.setHours(0, 0, 0, 0);

            // ============================================
            // Start date = 10 days before today
            // ============================================

            const startDate = new Date(endDate);
            startDate.setDate(startDate.getDate() - 10);

            // ============================================
            // Get paid orders from last 10 days
            // ============================================

            const orders = await strapi.db
                .query("api::order.order")
                .findMany({
                    where: {
                        paymentStatus: "paid",
                        createdAt: {
                            $gte: startDate,
                            $lt: endDate,
                        },
                    },
                    select: ["grandTotal", "createdAt"],
                });

            // ============================================
            // Initialize revenue for all 10 days
            // ============================================

            const revenueByDate: Record<string, number> = {};

            for (let i = 0; i < 10; i++) {
                const date = new Date(startDate);

                date.setDate(startDate.getDate() + i);

                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, "0");
                const day = String(date.getDate()).padStart(2, "0");

                const dateKey = `${year}-${month}-${day}`;

                revenueByDate[dateKey] = 0;
            }

            // ============================================
            // Add paid order grandTotal to its date
            // ============================================

            for (const order of orders) {
                if (!order.createdAt) {
                    continue;
                }

                const orderDate = new Date(order.createdAt);

                const year = orderDate.getFullYear();
                const month = String(orderDate.getMonth() + 1).padStart(2, "0");
                const day = String(orderDate.getDate()).padStart(2, "0");

                const dateKey = `${year}-${month}-${day}`;

                if (revenueByDate[dateKey] !== undefined) {
                    revenueByDate[dateKey] += Number(order.grandTotal || 0);
                }
            }

            // ============================================
            // Format response
            // ============================================

            const revenueTrends = Object.entries(revenueByDate).map(
                ([date, revenue]) => ({
                    date,
                    revenue: Number(revenue.toFixed(2)),
                })
            );

            // ============================================
            // Return response
            // ============================================

            return ctx.send({
                revenueTrends,
            });
        } catch (error) {
            console.error("Revenue trends error:", error);

            return ctx.internalServerError(
                "Unable to fetch revenue trends."
            );
        }
    },

    async allDashboardStats(ctx: Context) {
        try {
            // =====================================================
            // DATE SETUP
            // =====================================================

            const now = new Date();

            // Start of today
            const startOfToday = new Date(now);
            startOfToday.setHours(0, 0, 0, 0);

            // Start of tomorrow
            const startOfTomorrow = new Date(startOfToday);
            startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

            // Start of yesterday
            const startOfYesterday = new Date(startOfToday);
            startOfYesterday.setDate(startOfYesterday.getDate() - 1);

            // =====================================================
            // HELPER FOR PERCENTAGE CHANGE
            // =====================================================

            const calculatePercentageChange = (
                current: number,
                previous: number
            ) => {
                if (previous === 0) {
                    if (current === 0) {
                        return 0;
                    }

                    return 100;
                }

                return Number(
                    (((current - previous) / previous) * 100).toFixed(2)
                );
            };

            const getTrend = (percentage: number) => {
                if (percentage > 0) {
                    return "increased";
                }

                if (percentage < 0) {
                    return "decreased";
                }

                return "same";
            };

            // =====================================================
            // 1. TODAY'S ORDERS
            // =====================================================

            const todayOrders = await strapi.db
                .query("api::order.order")
                .count({
                    where: {
                        createdAt: {
                            $gte: startOfToday,
                            $lt: startOfTomorrow,
                        },
                    },
                });

            // Yesterday orders
            const yesterdayOrders = await strapi.db
                .query("api::order.order")
                .count({
                    where: {
                        createdAt: {
                            $gte: startOfYesterday,
                            $lt: startOfToday,
                        },
                    },
                });

            const ordersPercentage = calculatePercentageChange(
                todayOrders,
                yesterdayOrders
            );

            // =====================================================
            // 2. ACTIVE ORDERS
            // orderStatus = processing
            // =====================================================

            const activeOrders = await strapi.db
                .query("api::order.order")
                .count({
                    where: {
                        orderStatus: "processing",
                    },
                });

            // =====================================================
            // 3. TODAY'S REVENUE
            // Only paid orders
            // =====================================================

            const todayPaidOrders = await strapi.db
                .query("api::order.order")
                .findMany({
                    where: {
                        paymentStatus: "paid",
                        createdAt: {
                            $gte: startOfToday,
                            $lt: startOfTomorrow,
                        },
                    },
                    select: ["grandTotal"],
                });

            let todayRevenue = 0;

            for (const order of todayPaidOrders) {
                todayRevenue += Number(order.grandTotal || 0);
            }

            todayRevenue = Number(todayRevenue.toFixed(2));

            // =====================================================
            // Yesterday's revenue
            // =====================================================

            const yesterdayPaidOrders = await strapi.db
                .query("api::order.order")
                .findMany({
                    where: {
                        paymentStatus: "paid",
                        createdAt: {
                            $gte: startOfYesterday,
                            $lt: startOfToday,
                        },
                    },
                    select: ["grandTotal"],
                });

            let yesterdayRevenue = 0;

            for (const order of yesterdayPaidOrders) {
                yesterdayRevenue += Number(order.grandTotal || 0);
            }

            yesterdayRevenue = Number(yesterdayRevenue.toFixed(2));

            const revenuePercentage = calculatePercentageChange(
                todayRevenue,
                yesterdayRevenue
            );

            // =====================================================
            // 4. MONTHLY REVENUE
            //
            // Last 30 complete days
            // EXCLUDES TODAY
            // =====================================================

            const monthlyEndDate = new Date(startOfToday);

            const monthlyStartDate = new Date(startOfToday);
            monthlyStartDate.setDate(
                monthlyStartDate.getDate() - 30
            );

            // Previous 30-day period
            const previousMonthlyStartDate = new Date(
                monthlyStartDate
            );

            previousMonthlyStartDate.setDate(
                previousMonthlyStartDate.getDate() - 30
            );

            const previousMonthlyEndDate = new Date(
                monthlyStartDate
            );

            // =====================================================
            // Current 30-day paid revenue
            // =====================================================

            const monthlyPaidOrders = await strapi.db
                .query("api::order.order")
                .findMany({
                    where: {
                        paymentStatus: "paid",
                        createdAt: {
                            $gte: monthlyStartDate,
                            $lt: monthlyEndDate,
                        },
                    },
                    select: ["grandTotal"],
                });

            let monthlyRevenue = 0;

            for (const order of monthlyPaidOrders) {
                monthlyRevenue += Number(order.grandTotal || 0);
            }

            monthlyRevenue = Number(monthlyRevenue.toFixed(2));

            // =====================================================
            // Previous 30-day paid revenue
            // =====================================================

            const previousMonthlyPaidOrders = await strapi.db
                .query("api::order.order")
                .findMany({
                    where: {
                        paymentStatus: "paid",
                        createdAt: {
                            $gte: previousMonthlyStartDate,
                            $lt: previousMonthlyEndDate,
                        },
                    },
                    select: ["grandTotal"],
                });

            let previousMonthlyRevenue = 0;

            for (const order of previousMonthlyPaidOrders) {
                previousMonthlyRevenue += Number(order.grandTotal || 0);
            }

            previousMonthlyRevenue = Number(
                previousMonthlyRevenue.toFixed(2)
            );

            const monthlyRevenuePercentage =
                calculatePercentageChange(
                    monthlyRevenue,
                    previousMonthlyRevenue
                );

            // =====================================================
            // 5. TOTAL CUSTOMERS
            // =====================================================

            // Total customers
            const totalCustomers = await strapi.db
                .query("api::user-profile.user-profile")
                .count();

            // =====================================================
            // New customers in last 7 complete days
            // Exclude today
            // =====================================================

            const customerPeriodEnd = new Date(startOfToday);

            const customerPeriodStart = new Date(startOfToday);
            customerPeriodStart.setDate(
                customerPeriodStart.getDate() - 7
            );

            // Count customers created in the last 7 complete days
            const newCustomers = await strapi.db
                .query("api::user-profile.user-profile")
                .count({
                    where: {
                        createdAt: {
                            $gte: customerPeriodStart,
                            $lt: customerPeriodEnd,
                        },
                    },
                });

            // =====================================================
            // RESPONSE
            // =====================================================

            return ctx.send({
                todayOrders: {
                    count: todayOrders,
                    yesterdayCount: yesterdayOrders,
                    percentageChange: ordersPercentage,
                    trend: getTrend(ordersPercentage),
                },

                activeOrders: {
                    count: activeOrders,
                },

                todayRevenue: {
                    amount: todayRevenue,
                    yesterdayAmount: yesterdayRevenue,
                    percentageChange: revenuePercentage,
                    trend: getTrend(revenuePercentage),
                },

                monthlyRevenue: {
                    amount: monthlyRevenue,
                    previousPeriodAmount: previousMonthlyRevenue,
                    percentageChange: monthlyRevenuePercentage,
                    trend: getTrend(monthlyRevenuePercentage),
                },

                customers: {
                    total: totalCustomers,
                    newCustomers: newCustomers,

                },
            });
        } catch (error) {
            console.error("Dashboard stats error:", error);

            return ctx.internalServerError(
                "Unable to fetch dashboard statistics."
            );
        }
    },

    async markPaid(ctx: Context) {
        try {
            const user = ctx.state.user;

            // ============================================
            // 1. Check logged-in admin/staff
            // ============================================

            if (!user) {
                return ctx.unauthorized("You must be logged in.");
            }

            const { documentId } = ctx.params;

            // ============================================
            // 2. Find order + payment collection
            // ============================================

            const order = await strapi
                .documents("api::order.order")
                .findOne({
                    documentId,
                    populate: {
                        payment_collections: true,
                    },
                });

            if (!order) {
                return ctx.notFound("Order not found.");
            }

            // ============================================
            // 3. Check payment method
            // ============================================

            if (order.paymentMethod !== "cod") {
                return ctx.badRequest(
                    "Only COD orders can be marked as paid manually."
                );
            }

            // ============================================
            // 4. Check order status
            // ============================================

            if (order.orderStatus === "cancelled") {
                return ctx.badRequest(
                    "Cancelled order cannot be marked as paid."
                );
            }

            // ============================================
            // 5. Check current payment status
            // ============================================

            if (order.paymentStatus === "paid") {
                return ctx.badRequest("Order payment is already marked as paid.");
            }

            if (order.paymentStatus === "refunded") {
                return ctx.badRequest(
                    "Refunded order cannot be marked as paid."
                );
            }

            // ============================================
            // 6. Update order payment status
            // ============================================

            const updatedOrder = await strapi
                .documents("api::order.order")
                .update({
                    documentId,
                    data: {
                        paymentStatus: "paid",
                    },
                    populate: {
                        payment_collections: true,
                    },
                });

            // ============================================
            // 7. Update payment collection
            // ============================================

            const paymentCollections =
                (updatedOrder as any).payment_collections;

            if (paymentCollections?.length) {
                for (const payment of paymentCollections) {
                    await strapi
                        .documents(
                            "api::payment-collection.payment-collection"
                        )
                        .update({
                            documentId: payment.documentId,
                            data: {
                                payment_status: "paid",
                                paymentDate: new Date(),
                            },
                        });
                }
            }

            // ============================================
            // 8. Emit existing order update socket
            // ============================================

            const io = getIO();

            io.to(`order-${documentId}`).emit("order-updated", {
                order: updatedOrder,
                status: null,
            });

            io.to("admin-orders").emit("order-updated", {
                order: updatedOrder,
                status: null,
            });

            // ============================================
            // 9. Return response
            // ============================================

            return ctx.send({
                message: "Order payment marked as paid successfully.",
                orderDocumentId: updatedOrder?.documentId,
                orderNo: updatedOrder?.orderNo,
                orderStatus:updatedOrder?.orderStatus,
                paymentStatus:updatedOrder?.paymentStatus
            });
        } catch (error) {
            console.error("Mark order paid error:", error);

            return ctx.internalServerError(
                "Something went wrong while marking the order as paid."
            );
        }
    }

}