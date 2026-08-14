import type { Context } from "koa";
import { getIO } from "../../../socket";
import { createNotification } from "../../../utils/notification";
import { sendOrderConfirmationEmail } from "../../../utils/sendOrderConfirmationEmail";
import crypto from "crypto";
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

            const payments = await strapi.db
                .query("api::payment-collection.payment-collection")
                .findMany({
                    where: {
                        payment_status: "paid",
                        paymentDate: {
                            $gte: startDate,
                            $lt: endDate,
                        },
                    },
                    select: ["amount", "paymentDate"],
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

            for (const payment of payments) {
                if (!payment.paymentDate) {
                    continue;
                }

                const orderDate = new Date(payment.paymentDate);

                const year = orderDate.getFullYear();
                const month = String(orderDate.getMonth() + 1).padStart(2, "0");
                const day = String(orderDate.getDate()).padStart(2, "0");

                const dateKey = `${year}-${month}-${day}`;

                if (revenueByDate[dateKey] !== undefined) {
                    revenueByDate[dateKey] += Number(payment.amount || 0);
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

            const todayPayments = await strapi.db
                .query("api::payment-collection.payment-collection")
                .findMany({
                    where: {
                        payment_status: "paid",
                        paymentDate: {
                            $gte: startOfToday,
                            $lt: startOfTomorrow,
                        },
                    },
                    select: ["amount"],
                });

            let todayRevenue = 0;

            for (const payment of todayPayments) {
                todayRevenue += Number(payment.amount || 0);
            }

            todayRevenue = Number(todayRevenue.toFixed(2));
            // =====================================================
            // Yesterday's revenue
            // =====================================================
            const yesterdayPayments = await strapi.db
                .query("api::payment-collection.payment-collection")
                .findMany({
                    where: {
                        payment_status: "paid",
                        paymentDate: {
                            $gte: startOfYesterday,
                            $lt: startOfToday,
                        },
                    },
                    select: ["amount"],
                });

            let yesterdayRevenue = 0;

            for (const payment of yesterdayPayments) {
                yesterdayRevenue += Number(payment.amount || 0);
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
            // Based on paymentDate
            // =====================================================

            const monthlyPayments = await strapi.db
                .query("api::payment-collection.payment-collection")
                .findMany({
                    where: {
                        payment_status: "paid",
                        paymentDate: {
                            $gte: monthlyStartDate,
                            $lt: monthlyEndDate,
                        },
                    },
                    select: ["amount"],
                });

            let monthlyRevenue = 0;

            for (const payment of monthlyPayments) {
                monthlyRevenue += Number(payment.amount || 0);
            }

            monthlyRevenue = Number(
                monthlyRevenue.toFixed(2)
            );

            // =====================================================
            // Previous 30-day paid revenue
            // Based on paymentDate
            // =====================================================

            const previousMonthlyPayments = await strapi.db
                .query("api::payment-collection.payment-collection")
                .findMany({
                    where: {
                        payment_status: "paid",
                        paymentDate: {
                            $gte: previousMonthlyStartDate,
                            $lt: previousMonthlyEndDate,
                        },
                    },
                    select: ["amount"],
                });

            let previousMonthlyRevenue = 0;

            for (const payment of previousMonthlyPayments) {
                previousMonthlyRevenue += Number(payment.amount || 0);
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

    // async adminCreate(ctx: Context) {
    //     let trx: any = null;

    //     try {
    //         // ===============================================
    //         // Logged-in Admin / Staff
    //         // ===============================================

    //         const adminUser = ctx.state.user;

    //         if (!adminUser) {
    //             return ctx.unauthorized("You must be logged in.");
    //         }

    //         // ===============================================
    //         // Request Body
    //         // SAME FIELDS AS USER CART LOGIC
    //         // ===============================================

    //         const body = ctx.request.body?.data || ctx.request.body || {};

    //         const {
    //             userProfile,

    //             items = [],

    //             pickup_address,
    //             delivery_address,

    //             pickupDate,
    //             pickupTime,

    //             deliveryDate,
    //             deliveryTime,

    //             appointmentDate,
    //             appointmentTime,

    //             specialInstructions,
    //         } = body;

    //         // ===============================================
    //         // Validate Customer
    //         // ===============================================

    //         if (!userProfile) {
    //             return ctx.badRequest(
    //                 "Customer user profile is required."
    //             );
    //         }

    //         const customerProfile: any = await strapi
    //             .documents("api::user-profile.user-profile")
    //             .findOne({
    //                 documentId: userProfile,
    //             });

    //         if (!customerProfile) {
    //             return ctx.badRequest(
    //                 "Customer user profile not found."
    //             );
    //         }

    //         // ===============================================
    //         // Validate Items
    //         // SAME AS CART LOGIC
    //         // ===============================================

    //         if (!items || !items.length) {
    //             return ctx.badRequest(
    //                 "At least one item is required."
    //             );
    //         }

    //         // ===============================================
    //         // Validate Duplicate Items
    //         // ===============================================

    //         const uniqueItems = new Set();

    //         for (const item of items) {
    //             const key = `${item.service}-${item.service_varient || "flat"}`;

    //             if (uniqueItems.has(key)) {
    //                 return ctx.badRequest(
    //                     "Duplicate service/variant found. Please combine quantities."
    //                 );
    //             }

    //             uniqueItems.add(key);
    //         }

    //         // ===============================================
    //         // Validate Item Data
    //         // ===============================================

    //         for (const item of items) {
    //             if (!item.service) {
    //                 return ctx.badRequest(
    //                     "Service is required for every order item."
    //                 );
    //             }

    //             if (!item.quantity || Number(item.quantity) < 1) {
    //                 return ctx.badRequest(
    //                     "Quantity must be at least 1."
    //                 );
    //             }
    //         }

    //         // ===============================================
    //         // Validate Pickup Address
    //         // ===============================================

    //         let pickupAddress: any = null;

    //         if (pickup_address) {
    //             pickupAddress = await strapi
    //                 .documents("api::address.address")
    //                 .findOne({
    //                     documentId: pickup_address,
    //                     populate: {
    //                         user_profile: true,
    //                     },
    //                 });

    //             if (!pickupAddress) {
    //                 return ctx.badRequest(
    //                     "Pickup address not found."
    //                 );
    //             }

    //             if (
    //                 pickupAddress.user_profile?.documentId !==
    //                 customerProfile.documentId
    //             ) {
    //                 return ctx.forbidden(
    //                     "Pickup address does not belong to the selected customer."
    //                 );
    //             }
    //         }

    //         // ===============================================
    //         // Validate Delivery Address
    //         // ===============================================

    //         let deliveryAddress: any = null;

    //         if (delivery_address) {
    //             deliveryAddress = await strapi
    //                 .documents("api::address.address")
    //                 .findOne({
    //                     documentId: delivery_address,
    //                     populate: {
    //                         user_profile: true,
    //                     },
    //                 });

    //             if (!deliveryAddress) {
    //                 return ctx.badRequest(
    //                     "Delivery address not found."
    //                 );
    //             }

    //             if (
    //                 deliveryAddress.user_profile?.documentId !==
    //                 customerProfile.documentId
    //             ) {
    //                 return ctx.forbidden(
    //                     "Delivery address does not belong to the selected customer."
    //                 );
    //             }
    //         }

    //         // ===============================================
    //         // Validate Services & Calculate Prices
    //         // ===============================================

    //         trx = await strapi.db.transaction();

    //         let subTotal = 0;

    //         const preparedOrderItems: any[] = [];

    //         let scheduleType: string | null = null;

    //         for (const item of items) {
    //             // ===========================================
    //             // Fetch Service
    //             // ===========================================

    //             const service: any = await strapi
    //                 .documents("api::service.service")
    //                 .findOne({
    //                     documentId: item.service,
    //                     populate: {
    //                         service_pricings: true,
    //                         service_varients: {
    //                             populate: {
    //                                 service_pricings: true,
    //                             },
    //                         },
    //                     },
    //                 });

    //             if (!service) {
    //                 throw new Error("Service not found.");
    //             }

    //             if (!scheduleType) {
    //                 scheduleType = service.scheduleType;
    //             }

    //             let pricing: any = null;
    //             let variant: any = null;

    //             // ===========================================
    //             // Flat Pricing
    //             // ===========================================

    //             if (service.pricingModel === "flat") {
    //                 pricing = service.service_pricings?.[0];

    //                 if (!pricing) {
    //                     throw new Error(
    //                         `Pricing not found for service "${service.name}".`
    //                     );
    //                 }
    //             }

    //             // ===========================================
    //             // Variant Pricing
    //             // ===========================================

    //             else if (service.pricingModel === "variant") {
    //                 if (!item.service_varient) {
    //                     throw new Error(
    //                         `Variant is required for service "${service.name}".`
    //                     );
    //                 }

    //                 variant = service.service_varients?.find(
    //                     (v: any) =>
    //                         v.documentId === item.service_varient
    //                 );

    //                 if (!variant) {
    //                     throw new Error(
    //                         `Variant not found for service "${service.name}".`
    //                     );
    //                 }

    //                 pricing = variant.service_pricings?.[0];

    //                 if (!pricing) {
    //                     throw new Error(
    //                         `Pricing not found for variant "${variant.name}".`
    //                     );
    //                 }
    //             } else {
    //                 throw new Error("Invalid pricing model.");
    //             }

    //             // ===========================================
    //             // Determine Effective Price
    //             // ===========================================

    //             if (pricing.price == null) {
    //                 throw new Error(
    //                     `Price not configured for "${service.name}".`
    //                 );
    //             }

    //             const unitPrice = Number(pricing.price);

    //             if (
    //                 pricing.offerPrice != null &&
    //                 Number(pricing.offerPrice) > unitPrice
    //             ) {
    //                 throw new Error(
    //                     `Offer price cannot be greater than regular price for "${service.name}".`
    //                 );
    //             }

    //             const offerPrice =
    //                 pricing.offerPrice !== null &&
    //                     pricing.offerPrice !== undefined
    //                     ? Number(pricing.offerPrice)
    //                     : null;

    //             const effectivePrice =
    //                 offerPrice !== null
    //                     ? offerPrice
    //                     : unitPrice;

    //             const expressDeliveryPrice = Number(
    //                 pricing.expressDeliveryPrice || 0
    //             );

    //             const quantity = Number(item.quantity);

    //             // ===========================================
    //             // Calculate Item Total
    //             // ===========================================

    //             let itemTotal =
    //                 effectivePrice * quantity;

    //             if (item.expressDelivery) {
    //                 itemTotal +=
    //                     expressDeliveryPrice * quantity;
    //             }

    //             itemTotal = Number(
    //                 itemTotal.toFixed(2)
    //             );

    //             subTotal += itemTotal;

    //             // ===========================================
    //             // Prepare Order Item
    //             // ===========================================

    //             preparedOrderItems.push({
    //                 service: service.documentId,

    //                 serviceName: service.name,

    //                 service_varient:
    //                     variant?.documentId || null,

    //                 variantName:
    //                     variant?.name || null,

    //                 service_pricing:
    //                     pricing.documentId,

    //                 quantity,

    //                 unitPrice,

    //                 offerPrice,

    //                 expressDelivery:
    //                     !!item.expressDelivery,

    //                 expressDeliveryPrice:
    //                     item.expressDelivery
    //                         ? expressDeliveryPrice
    //                         : 0,

    //                 totalPrice: itemTotal,

    //                 remarks:
    //                     item.remarks || null,
    //             });
    //         }

    //         // ===============================================
    //         // Validate Schedule
    //         // ===============================================

    //         if (scheduleType === "pickup_delivery") {
    //             if (!pickup_address) {
    //                 throw new Error(
    //                     "Pickup address is required."
    //                 );
    //             }

    //             if (!delivery_address) {
    //                 throw new Error(
    //                     "Delivery address is required."
    //                 );
    //             }

    //             if (!pickupDate) {
    //                 throw new Error(
    //                     "Pickup date is required."
    //                 );
    //             }

    //             if (!pickupTime) {
    //                 throw new Error(
    //                     "Pickup time is required."
    //                 );
    //             }

    //             if (!deliveryDate) {
    //                 throw new Error(
    //                     "Delivery date is required."
    //                 );
    //             }

    //             if (!deliveryTime) {
    //                 throw new Error(
    //                     "Delivery time is required."
    //                 );
    //             }
    //         }

    //         if (scheduleType === "appointment") {
    //             if (!pickup_address) {
    //                 throw new Error(
    //                     "Pickup address is required."
    //                 );
    //             }

    //             if (!appointmentDate) {
    //                 throw new Error(
    //                     "Appointment date is required."
    //                 );
    //             }

    //             if (!appointmentTime) {
    //                 throw new Error(
    //                     "Appointment time is required."
    //                 );
    //             }
    //         }

    //         // ===============================================
    //         // Calculate Totals
    //         // ===============================================

    //         const tax = 0;
    //         const discount = 0;
    //         const deliveryCharge = 0;

    //         const grandTotal = Number(
    //             (
    //                 subTotal +
    //                 tax +
    //                 deliveryCharge -
    //                 discount
    //             ).toFixed(2)
    //         );

    //         // ===============================================
    //         // Generate Order Number
    //         // ===============================================

    //         const year = new Date()
    //             .getFullYear()
    //             .toString()
    //             .slice(-2);

    //         let orderNo = "";
    //         let exists = true;

    //         while (exists) {
    //             const randomCode = crypto
    //                 .randomBytes(3)
    //                 .toString("hex")
    //                 .toUpperCase();

    //             orderNo = `ORD${year}-${randomCode}`;

    //             const existingOrder = await strapi.db
    //                 .query("api::order.order")
    //                 .findOne({
    //                     where: {
    //                         orderNo,
    //                     },
    //                     select: ["id"],
    //                 });

    //             exists = !!existingOrder;
    //         }

    //         // ===============================================
    //         // Create Order
    //         // ===============================================

    //         const createdOrder = await strapi
    //             .documents("api::order.order")
    //             .create({
    //                 data: {
    //                     orderNo,

    //                     // ===================================
    //                     // Schedule
    //                     // ===================================

    //                     pickupDate:
    //                         pickupDate || null,

    //                     pickupTime:
    //                         pickupTime || null,

    //                     deliveryDate:
    //                         deliveryDate || null,

    //                     deliveryTime:
    //                         deliveryTime || null,

    //                     appointmentDate:
    //                         appointmentDate || null,

    //                     appointmentTime:
    //                         appointmentTime || null,

    //                     // ===================================
    //                     // COD ONLY
    //                     // ===================================

    //                     paymentMethod: "cod",
    //                     paymentStatus: "pending",
    //                     orderStatus: "pending",

    //                     // ===================================
    //                     // Calculated Totals
    //                     // ===================================

    //                     subTotal,
    //                     tax,
    //                     discount,
    //                     deliveryCharge,
    //                     grandTotal,

    //                     specialInstruction:
    //                         specialInstructions || null,

    //                     // ===================================
    //                     // Addresses
    //                     // ===================================

    //                     pickup_address:
    //                         pickupAddress?.documentId || null,

    //                     delivery_address:
    //                         deliveryAddress?.documentId || null,

    //                     // ===================================
    //                     // Customer
    //                     // ===================================

    //                     user_profile:
    //                         customerProfile.documentId,
    //                 },

    //                 transaction: trx,
    //             });

    //         // ===============================================
    //         // Create Order Items
    //         // ===============================================

    //         for (const item of preparedOrderItems) {
    //             await strapi
    //                 .documents(
    //                     "api::order-item.order-item"
    //                 )
    //                 .create({
    //                     data: {
    //                         order:
    //                             createdOrder.documentId,

    //                         service:
    //                             item.service,

    //                         service_varient:
    //                             item.service_varient,

    //                         service_pricing:
    //                             item.service_pricing,

    //                         quantity:
    //                             item.quantity,

    //                         unitPrice:
    //                             item.unitPrice,

    //                         offerPrice:
    //                             item.offerPrice,

    //                         expressDelivery:
    //                             item.expressDelivery,

    //                         expressDeliveryPrice:
    //                             item.expressDeliveryPrice,

    //                         totalPrice:
    //                             item.totalPrice,

    //                         remarks:
    //                             item.remarks,
    //                     },

    //                     transaction: trx,
    //                 });
    //         }

    //         // ===============================================
    //         // Create Payment Collection
    //         // ===============================================

    //         await strapi
    //             .documents(
    //                 "api::payment-collection.payment-collection"
    //             )
    //             .create({
    //                 data: {
    //                     order:
    //                         createdOrder.documentId,

    //                     amount: grandTotal,

    //                     payment_status:
    //                         "pending",
    //                 },

    //                 transaction: trx,
    //             });

    //         // ===============================================
    //         // Create Initial Status History
    //         // ===============================================

    //         await strapi
    //             .documents(
    //                 "api::order-status-history.order-status-history"
    //             )
    //             .create({
    //                 data: {
    //                     order:
    //                         createdOrder.documentId,

    //                     statusUpdatedTo:
    //                         "pending",

    //                     status_updated_by:
    //                         adminUser.documentId,

    //                     updatedByType:
    //                         "admin",
    //                 },

    //                 transaction: trx,
    //             });


    //         // ===============================================
    //         // Commit Transaction
    //         // ===============================================

    //         await trx.commit();
    //         trx = null;

    //         // ===============================================
    //         // Prepare Response
    //         // ===============================================

    //         const response = {
    //             message: "Order created successfully.",
    //             documentId: createdOrder.documentId,
    //             orderNo,
    //         };

    //         // ===============================================
    //         // Background Tasks
    //         // ===============================================

    //         setImmediate(async () => {

    //             // ==========================================
    //             // 1. Send Email To Customer
    //             // ==========================================

    //             try {
    //                 const emailItems =
    //                     preparedOrderItems.map(
    //                         (item: any) => ({
    //                             serviceName:
    //                                 item.serviceName,

    //                             variantName:
    //                                 item.variantName,

    //                             quantity:
    //                                 item.quantity,

    //                             totalPrice:
    //                                 item.totalPrice,
    //                         })
    //                     );

    //                 await sendOrderConfirmationEmail(
    //                     customerProfile.email,
    //                     customerProfile.fullName,
    //                     orderNo,
    //                     grandTotal,
    //                     "cod",
    //                     emailItems
    //                 );
    //             } catch (emailError) {
    //                 strapi.log.error(
    //                     `Order ${orderNo} email failed:`,
    //                     emailError
    //                 );
    //             }

    //             // ==========================================
    //             // 2. Create Notification
    //             // ==========================================

    //             try {
    //                 await createNotification({
    //                     strapi,

    //                     title:
    //                         "New Order Received",

    //                     description:
    //                         `New order ${orderNo} has been received.`,

    //                     type: "order",
    //                 });
    //             } catch (notificationError) {
    //                 strapi.log.error(
    //                     `Order ${orderNo} notification failed:`,
    //                     notificationError
    //                 );
    //             }

    //             // ==========================================
    //             // 3. Emit Socket
    //             // ==========================================

    //             try {
    //                 const order = await strapi
    //                     .documents("api::order.order")
    //                     .findOne({
    //                         documentId:
    //                             createdOrder.documentId,

    //                         populate: {
    //                             pickup_address: true,
    //                             delivery_address: true,
    //                             user_profile: true,

    //                             order_items: {
    //                                 populate: {
    //                                     service: true,
    //                                     service_varient: true,
    //                                     service_pricing: true,
    //                                 },
    //                             },
    //                         },
    //                     });

    //                 const io = getIO();

    //                 io.to("admin-orders").emit(
    //                     "order-created",
    //                     {
    //                         order,
    //                     }
    //                 );
    //             } catch (socketError) {
    //                 strapi.log.error(
    //                     `Order ${orderNo} socket emission failed:`,
    //                     socketError
    //                 );
    //             }
    //         });

    //         // ===============================================
    //         // Final Response
    //         // ===============================================

    //         return ctx.send(response);

    //     } catch (error: any) {
    //         // ===============================================
    //         // Rollback
    //         // ===============================================

    //         if (trx) {
    //             try {
    //                 await trx.rollback();
    //             } catch (rollbackError) {
    //                 strapi.log.error(
    //                     "Admin order rollback failed:",
    //                     rollbackError
    //                 );
    //             }
    //         }

    //         strapi.log.error(
    //             "Admin Create Order Error:",
    //             error
    //         );

    //         return ctx.badRequest(
    //             error?.message ||
    //             "Failed to create order."
    //         );
    //     }
    // },

    async adminCreate(ctx: Context) {
    let trx: any = null;

    try {
        // ===============================================
        // Logged-in Admin / Staff
        // ===============================================

        const adminUser = ctx.state.user;

        if (!adminUser) {
            return ctx.unauthorized("You must be logged in.");
        }

        // ===============================================
        // Request Body
        // ===============================================

        const body =
            ctx.request.body?.data ||
            ctx.request.body ||
            {};

        const {
            userProfile,

            items = [],

            pickup_address,
            delivery_address,

            pickupDate,
            pickupTime,

            deliveryDate,
            deliveryTime,

            appointmentDate,
            appointmentTime,

            specialInstructions,
        } = body;

        // ===============================================
        // Validate Customer
        // ===============================================

        if (!userProfile) {
            return ctx.badRequest(
                "Customer user profile is required."
            );
        }

        const customerProfile: any =
            await strapi
                .documents(
                    "api::user-profile.user-profile"
                )
                .findOne({
                    documentId: userProfile,
                });

        if (!customerProfile) {
            return ctx.badRequest(
                "Customer user profile not found."
            );
        }

        // ===============================================
        // Validate Items
        // ===============================================

        if (!items || !items.length) {
            return ctx.badRequest(
                "At least one item is required."
            );
        }

        // ===============================================
        // Validate Duplicate Items
        // ===============================================

        const uniqueItems = new Set();

        for (const item of items) {
            const key =
                `${item.service}-${item.service_varient || "flat"}`;

            if (uniqueItems.has(key)) {
                return ctx.badRequest(
                    "Duplicate service/variant found. Please combine quantities."
                );
            }

            uniqueItems.add(key);
        }

        // ===============================================
        // Validate Item Data
        // ===============================================

        for (const item of items) {
            if (!item.service) {
                return ctx.badRequest(
                    "Service is required for every order item."
                );
            }

            if (
                !item.quantity ||
                Number(item.quantity) < 1
            ) {
                return ctx.badRequest(
                    "Quantity must be at least 1."
                );
            }
        }

        // ===============================================
        // Validate Pickup Address
        // ===============================================

        let pickupAddress: any = null;

        if (pickup_address) {
            pickupAddress =
                await strapi
                    .documents(
                        "api::address.address"
                    )
                    .findOne({
                        documentId: pickup_address,

                        populate: {
                            user_profile: true,
                        },
                    });

            if (!pickupAddress) {
                return ctx.badRequest(
                    "Pickup address not found."
                );
            }

            if (
                pickupAddress.user_profile?.documentId !==
                customerProfile.documentId
            ) {
                return ctx.forbidden(
                    "Pickup address does not belong to the selected customer."
                );
            }
        }

        // ===============================================
        // Validate Delivery Address
        // ===============================================

        let deliveryAddress: any = null;

        if (delivery_address) {
            deliveryAddress =
                await strapi
                    .documents(
                        "api::address.address"
                    )
                    .findOne({
                        documentId: delivery_address,

                        populate: {
                            user_profile: true,
                        },
                    });

            if (!deliveryAddress) {
                return ctx.badRequest(
                    "Delivery address not found."
                );
            }

            if (
                deliveryAddress.user_profile?.documentId !==
                customerProfile.documentId
            ) {
                return ctx.forbidden(
                    "Delivery address does not belong to the selected customer."
                );
            }
        }

        // ===============================================
        // Start Transaction
        // ===============================================

        trx = await strapi.db.transaction();

        // ===============================================
        // Validate Services & Calculate Prices
        // ===============================================

        const preparedOrderItems: any[] = [];

        let scheduleType: string | null = null;

        for (const item of items) {
            // ===========================================
            // Fetch Service
            // ===========================================

            const service: any =
                await strapi
                    .documents(
                        "api::service.service"
                    )
                    .findOne({
                        documentId: item.service,

                        populate: {
                            service_pricings: true,

                            service_varients: {
                                populate: {
                                    service_pricings: true,
                                },
                            },
                        },
                    });

            if (!service) {
                throw new Error(
                    "Service not found."
                );
            }

            if (!scheduleType) {
                scheduleType =
                    service.scheduleType;
            }

            let pricing: any = null;
            let variant: any = null;

            // ===========================================
            // Flat Pricing
            // ===========================================

            if (
                service.pricingModel === "flat"
            ) {
                pricing =
                    service.service_pricings?.[0];

                if (!pricing) {
                    throw new Error(
                        `Pricing not found for service "${service.name}".`
                    );
                }
            }

            // ===========================================
            // Variant Pricing
            // ===========================================

            else if (
                service.pricingModel === "variant"
            ) {
                if (!item.service_varient) {
                    throw new Error(
                        `Variant is required for service "${service.name}".`
                    );
                }

                variant =
                    service.service_varients?.find(
                        (v: any) =>
                            v.documentId ===
                            item.service_varient
                    );

                if (!variant) {
                    throw new Error(
                        `Variant not found for service "${service.name}".`
                    );
                }

                pricing =
                    variant.service_pricings?.[0];

                if (!pricing) {
                    throw new Error(
                        `Pricing not found for variant "${variant.name}".`
                    );
                }
            }

            else {
                throw new Error(
                    "Invalid pricing model."
                );
            }

            // ===========================================
            // Determine Effective Price
            // ===========================================

            if (pricing.price == null) {
                throw new Error(
                    `Price not configured for "${service.name}".`
                );
            }

            const unitPrice =
                Number(pricing.price);

            if (
                pricing.offerPrice != null &&
                Number(pricing.offerPrice) >
                    unitPrice
            ) {
                throw new Error(
                    `Offer price cannot be greater than regular price for "${service.name}".`
                );
            }

            const offerPrice =
                pricing.offerPrice !== null &&
                pricing.offerPrice !== undefined
                    ? Number(pricing.offerPrice)
                    : null;

            const effectivePrice =
                offerPrice !== null
                    ? offerPrice
                    : unitPrice;

            // ===========================================
            // Express Delivery Price
            // ===========================================

            const expressDeliveryPrice =
                Number(
                    pricing.expressDeliveryPrice || 0
                );

            const quantity =
                Number(item.quantity);

            // ===========================================
            // Calculate Item Total
            // ===========================================

            let itemTotal =
                effectivePrice * quantity;

            // Express fee is added HERE
            // and therefore already exists inside
            // item.totalPrice.

            if (item.expressDelivery) {
                itemTotal +=
                    expressDeliveryPrice *
                    quantity;
            }

            itemTotal = Number(
                itemTotal.toFixed(2)
            );

            // ===========================================
            // Prepare Order Item
            // ===========================================

            preparedOrderItems.push({
                service:
                    service.documentId,

                serviceName:
                    service.name,

                service_varient:
                    variant?.documentId ||
                    null,

                variantName:
                    variant?.name ||
                    null,

                service_pricing:
                    pricing.documentId,

                quantity,

                unitPrice,

                offerPrice,

                expressDelivery:
                    !!item.expressDelivery,

                expressDeliveryPrice:
                    item.expressDelivery
                        ? expressDeliveryPrice
                        : 0,

                totalPrice:
                    itemTotal,

                remarks:
                    item.remarks ||
                    null,
            });
        }

        // ===============================================
        // Validate Schedule
        // ===============================================

        if (
            scheduleType ===
            "pickup_delivery"
        ) {
            if (!pickup_address) {
                throw new Error(
                    "Pickup address is required."
                );
            }

            if (!delivery_address) {
                throw new Error(
                    "Delivery address is required."
                );
            }

            if (!pickupDate) {
                throw new Error(
                    "Pickup date is required."
                );
            }

            if (!pickupTime) {
                throw new Error(
                    "Pickup time is required."
                );
            }

            if (!deliveryDate) {
                throw new Error(
                    "Delivery date is required."
                );
            }

            if (!deliveryTime) {
                throw new Error(
                    "Delivery time is required."
                );
            }
        }

        if (
            scheduleType ===
            "appointment"
        ) {
            if (!pickup_address) {
                throw new Error(
                    "Pickup address is required."
                );
            }

            if (!appointmentDate) {
                throw new Error(
                    "Appointment date is required."
                );
            }

            if (!appointmentTime) {
                throw new Error(
                    "Appointment time is required."
                );
            }
        }

        // ===============================================
        // Split Normal & Express Items
        // ===============================================

        const normalItems =
            preparedOrderItems.filter(
                (item: any) =>
                    item.expressDelivery !== true
            );

        const expressItems =
            preparedOrderItems.filter(
                (item: any) =>
                    item.expressDelivery === true
            );

        // ===============================================
        // Create Order Helper
        // ===============================================

        const createOrderForItems = async (
            orderItems: any[],
            isExpressOrder: boolean
        ) => {
            if (!orderItems.length) {
                return null;
            }

            // ===========================================
            // Calculate THIS Order Subtotal
            // ===========================================

            // IMPORTANT:
            // Express fee is already inside item.totalPrice

            const orderSubTotal =
                Number(
                    orderItems
                        .reduce(
                            (
                                sum: number,
                                item: any
                            ) =>
                                sum +
                                Number(
                                    item.totalPrice ||
                                    0
                                ),
                            0
                        )
                        .toFixed(2)
                );

            // Current business logic
            const tax = 0;
            const discount = 0;
            const deliveryCharge = 0;

            const grandTotal =
                Number(
                    (
                        orderSubTotal +
                        tax +
                        deliveryCharge -
                        discount
                    ).toFixed(2)
                );

            // ===========================================
            // Generate Unique Order Number
            // ===========================================

            const year =
                new Date()
                    .getFullYear()
                    .toString()
                    .slice(-2);

            let orderNo = "";
            let exists = true;

            while (exists) {
                const randomCode =
                    crypto
                        .randomBytes(3)
                        .toString("hex")
                        .toUpperCase();

                orderNo =
                    `ORD${year}-${randomCode}`;

                const existingOrder =
                    await strapi.db
                        .query(
                            "api::order.order"
                        )
                        .findOne({
                            where: {
                                orderNo,
                            },

                            select: [
                                "id",
                            ],
                        });

                exists =
                    !!existingOrder;
            }

            // ===========================================
            // Delivery Date / Time
            // ===========================================

            // Normal order keeps the exact
            // delivery selected by admin.

            let orderDeliveryDate =
                deliveryDate || null;

            let orderDeliveryTime =
                deliveryTime || null;

            // ===========================================
            // EXPRESS = PICKUP + 24 HOURS
            // ===========================================

            if (
                isExpressOrder &&
                scheduleType ===
                    "pickup_delivery"
            ) {
                const pickupDateTime =
                    new Date(
                        `${pickupDate}T${pickupTime}`
                    );

                if (
                    isNaN(
                        pickupDateTime.getTime()
                    )
                ) {
                    throw new Error(
                        "Invalid pickup date or time."
                    );
                }

                // Exactly 24 hours after pickup
                pickupDateTime.setTime(
                    pickupDateTime.getTime() +
                    24 * 60 * 60 * 1000
                );

                const yearValue =
                    pickupDateTime.getFullYear();

                const monthValue =
                    String(
                        pickupDateTime.getMonth() +
                            1
                    ).padStart(2, "0");

                const dayValue =
                    String(
                        pickupDateTime.getDate()
                    ).padStart(2, "0");

                const hoursValue =
                    String(
                        pickupDateTime.getHours()
                    ).padStart(2, "0");

                const minutesValue =
                    String(
                        pickupDateTime.getMinutes()
                    ).padStart(2, "0");

                orderDeliveryDate =
                    `${yearValue}-${monthValue}-${dayValue}`;

                // Strapi expects HH:mm:ss.SSS
                orderDeliveryTime =
                    `${hoursValue}:${minutesValue}:00.000`;
            }

            // ===========================================
            // Create Order
            // ===========================================

            const createdOrder =
                await strapi
                    .documents(
                        "api::order.order"
                    )
                    .create({
                        data: {
                            orderNo,

                            // =================================
                            // Schedule
                            // =================================

                            pickupDate:
                                pickupDate ||
                                null,

                            pickupTime:
                                pickupTime ||
                                null,

                            deliveryDate:
                                orderDeliveryDate,

                            deliveryTime:
                                orderDeliveryTime,

                            appointmentDate:
                                appointmentDate ||
                                null,

                            appointmentTime:
                                appointmentTime ||
                                null,

                            // =================================
                            // COD
                            // =================================

                            paymentMethod:
                                "cod",

                            paymentStatus:
                                "pending",

                            orderStatus:
                                "pending",

                            // =================================
                            // Totals
                            // =================================

                            subTotal:
                                orderSubTotal,

                            tax,

                            discount,

                            deliveryCharge,

                            grandTotal,

                            specialInstruction:
                                specialInstructions ||
                                null,

                            // =================================
                            // Addresses
                            // =================================

                            pickup_address:
                                pickupAddress
                                    ?.documentId ||
                                null,

                            delivery_address:
                                deliveryAddress
                                    ?.documentId ||
                                null,

                            // =================================
                            // Customer
                            // =================================

                            user_profile:
                                customerProfile.documentId,
                        },

                        transaction: trx,
                    });

            // ===========================================
            // Create Order Items
            // ===========================================

            for (
                const item of orderItems
            ) {
                await strapi
                    .documents(
                        "api::order-item.order-item"
                    )
                    .create({
                        data: {
                            order:
                                createdOrder.documentId,

                            service:
                                item.service,

                            service_varient:
                                item.service_varient,

                            service_pricing:
                                item.service_pricing,

                            quantity:
                                item.quantity,

                            unitPrice:
                                item.unitPrice,

                            offerPrice:
                                item.offerPrice,

                            expressDelivery:
                                item.expressDelivery,

                            expressDeliveryPrice:
                                item.expressDeliveryPrice,

                            totalPrice:
                                item.totalPrice,

                            remarks:
                                item.remarks,
                        },

                        transaction:
                            trx,
                    });
            }

            // ===========================================
            // Payment Collection
            // ===========================================

            await strapi
                .documents(
                    "api::payment-collection.payment-collection"
                )
                .create({
                    data: {
                        order:
                            createdOrder.documentId,

                        amount:
                            grandTotal,

                        payment_status:
                            "pending",
                    },

                    transaction:
                        trx,
                });

            // ===========================================
            // Status History
            // ===========================================

            await strapi
                .documents(
                    "api::order-status-history.order-status-history"
                )
                .create({
                    data: {
                        order:
                            createdOrder.documentId,

                        statusUpdatedTo:
                            "pending",

                        status_updated_by:
                            adminUser.documentId,

                        updatedByType:
                            "admin",
                    },

                    transaction:
                        trx,
                });

            return {
                order:
                    createdOrder,

                orderNo,

                items:
                    orderItems,

                grandTotal,
            };
        };

        // ===============================================
        // Create Normal Order
        // ===============================================

        const normalOrder =
            await createOrderForItems(
                normalItems,
                false
            );

        // ===============================================
        // Create Express Order
        // ===============================================

        const expressOrder =
            await createOrderForItems(
                expressItems,
                true
            );

        // ===============================================
        // Created Orders
        // ===============================================

        const createdOrders: any[] = [
            normalOrder,
            expressOrder,
        ].filter(Boolean);

        // ===============================================
        // Commit Transaction
        // ===============================================

        await trx.commit();
        trx = null;

        // ===============================================
        // Response
        // ===============================================

        const response = {
            message:
                "Orders created successfully.",

            orders:
                createdOrders.map(
                    (created: any) => ({
                        documentId:
                            created.order.documentId,

                        orderNo:
                            created.orderNo,

                        grandTotal:
                            created.grandTotal,

                        express:
                            created.items.some(
                                (item: any) =>
                                    item.expressDelivery ===
                                    true
                            ),
                    })
                ),
        };

        // ===============================================
        // Background Tasks
        // ===============================================

        setImmediate(async () => {

            // ==========================================
            // 1. Email For Each Order
            // ==========================================

            for (
                const created of createdOrders
            ) {
                try {
                    const emailItems =
                        created.items.map(
                            (item: any) => ({
                                serviceName:
                                    item.serviceName,

                                variantName:
                                    item.variantName,

                                quantity:
                                    item.quantity,

                                totalPrice:
                                    item.totalPrice,
                            })
                        );

                    await sendOrderConfirmationEmail(
                        customerProfile.email,
                        customerProfile.fullName,
                        created.orderNo,
                        created.grandTotal,
                        "cod",
                        emailItems
                    );

                } catch (emailError) {
                    strapi.log.error(
                        `Order ${created.orderNo} - Email failed:`,
                        emailError
                    );
                }
            }

            // ==========================================
            // 2. Notification For Each Order
            // ==========================================

            for (
                const created of createdOrders
            ) {
                try {
                    await createNotification({
                        strapi,

                        title:
                            "New Order Received",

                        description:
                            `New order ${created.orderNo} has been received.`,

                        type:
                            "order",
                    });

                } catch (
                    notificationError
                ) {
                    strapi.log.error(
                        `Order ${created.orderNo} - Notification failed:`,
                        notificationError
                    );
                }
            }

            // ==========================================
            // 3. Socket For Each Order
            // ==========================================

            for (
                const created of createdOrders
            ) {
                try {
                    const order =
                        await strapi
                            .documents(
                                "api::order.order"
                            )
                            .findOne({
                                documentId:
                                    created.order
                                        .documentId,

                                populate: {
                                    pickup_address:
                                        true,

                                    delivery_address:
                                        true,

                                    user_profile:
                                        true,

                                    order_items: {
                                        populate: {
                                            service:
                                                true,

                                            service_varient:
                                                true,

                                            service_pricing:
                                                true,
                                        },
                                    },
                                },
                            });

                    const io = getIO();

                    io.to(
                        "admin-orders"
                    ).emit(
                        "order-created",
                        {
                            order,
                        }
                    );

                } catch (socketError) {
                    strapi.log.error(
                        `Order ${created.orderNo} - Socket emission failed:`,
                        socketError
                    );
                }
            }
        });

        // ===============================================
        // Final Response
        // ===============================================

        return ctx.send(response);

    } catch (error: any) {

        // ===============================================
        // Rollback
        // ===============================================

        if (trx) {
            try {
                await trx.rollback();
            } catch (
                rollbackError
            ) {
                strapi.log.error(
                    "Admin order rollback failed:",
                    rollbackError
                );
            }
        }

        strapi.log.error(
            "Admin Create Order Error:",
            error
        );

        return ctx.badRequest(
            error?.message ||
            "Failed to create order."
        );
    }
},

}