/**
 * order controller
 */

import { factories } from "@strapi/strapi";
import crypto from "crypto";
import axios from "axios";
import { sendOrderConfirmationEmail } from "../../../utils/sendOrderConfirmationEmail";
import { createNotification } from "../../../utils/notification";
import { getIO } from "../../../socket";

export default factories.createCoreController(
    "api::order.order",
    ({ strapi }) => ({
        async create(ctx) {
            const trx = await strapi.db.transaction();

            try {
                // Logged-in user
                const user = ctx.state.user;

                if (!user) {
                    return ctx.unauthorized("You must be logged in.");
                }

                const body = ctx.request.body?.data || ctx.request.body || {};

                const { paymentMethod } = body;

                // ===============================
                // Validate Required Fields
                // ===============================

                if (!paymentMethod) {
                    return ctx.badRequest("Payment method is required.");
                }

                const allowedPaymentMethods = [
                    "online",
                    "cod",
                ];

                if (!allowedPaymentMethods.includes(paymentMethod)) {
                    return ctx.badRequest("Invalid payment method.");
                }

                // ===============================
                // Get Logged-in User Profile
                // ===============================

                const userProfile = await strapi.db
                    .query("api::user-profile.user-profile")
                    .findOne({
                        where: {
                            users_permissions_user: user.id,
                        },
                    });

                if (!userProfile) {
                    return ctx.badRequest("User profile not found.");
                }

                // ===============================================
                // Get User Cart
                // ===============================================

                const cart = await strapi.documents("api::cart.cart").findFirst({
                    filters: {
                        user_profile: {
                            documentId: userProfile.documentId,
                        },
                    },
                    populate: {
                        pickup_address: true,
                        delivery_address: true,

                        cart_items: {
                            populate: {
                                service: true,
                                service_varient: true,
                                service_pricing: true,
                            },
                        },
                    },
                });

                if (!cart) {
                    return ctx.badRequest("Cart not found.");
                }

                if (!cart.cart_items?.length) {
                    return ctx.badRequest("Cart is empty.");
                }

                // ===============================
                // Generate Order Number
                // ===============================

                const year = new Date().getFullYear().toString().slice(-2);

                let orderNo = "";
                let exists = true;

                while (exists) {
                    const randomCode = crypto
                        .randomBytes(3)
                        .toString("hex")
                        .toUpperCase();

                    orderNo = `ORD${year}-${randomCode}`;

                    const existingOrder = await strapi.db
                        .query("api::order.order")
                        .findOne({
                            where: { orderNo },
                            select: ["id"],
                        });

                    exists = !!existingOrder;
                }

                // ===============================================
                // Determine Schedule Type
                // ===============================================

                const orderScheduleType =
                    (cart.cart_items[0] as any).service?.scheduleType;

                if (orderScheduleType === "pickup_delivery") {
                    if (!cart.pickup_address) {
                        throw new Error("Pickup address is missing.");
                    }

                    if (!cart.delivery_address) {
                        throw new Error("Delivery address is missing.");
                    }

                    if (!cart.pickupDate) {
                        throw new Error("Pickup date is missing.");
                    }

                    if (!cart.pickupTime) {
                        throw new Error("Pickup time is missing.");
                    }

                    if (!cart.deliveryDate) {
                        throw new Error("Delivery date is missing.");
                    }

                    if (!cart.deliveryTime) {
                        throw new Error("Delivery time is missing.");
                    }
                }

                if (orderScheduleType === "appointment") {
                    if (!cart.pickup_address) {
                        throw new Error("Pickup address is missing.");
                    }

                    if (!cart.appointmentDate) {
                        throw new Error("Appointment date is missing.");
                    }

                    if (!cart.appointmentTime) {
                        throw new Error("Appointment time is missing.");
                    }
                }

                if (paymentMethod === "online") {

                    let paymentCollection: any = null;
                    let paymentUrl: string | null = null;

                    paymentCollection = await strapi
                        .documents("api::payment-collection.payment-collection")
                        .create({
                            data: {
                                cart: (cart as any).documentId,
                                amount: Number((cart as any).grandTotal),
                                payment_status: "pending",
                            },
                            transaction: trx,
                        });

                    await trx.commit();

                    try {

                        const response = await axios.post(
                            "https://upigateway.dev/api/create-order",
                            {
                                customer_mobile: userProfile.phoneNumber,
                                user_token: process.env.UPI_GATEWAY_TOKEN,
                                amount: Number((cart as any).grandTotal).toString(),
                                order_id: orderNo,
                                redirect_url: `${process.env.FRONTEND_URL}/payment-success`,
                                remark1: orderNo,
                                remark2: paymentCollection.documentId,
                            },
                            {
                                headers: {
                                    "Content-Type": "application/json",
                                },
                            }
                        );

                        const result = response.data;

                        if (!result.status) {
                            throw new Error(result.message || "Unable to create payment.");
                        }

                        paymentUrl = result.result.payment_url;

                        await strapi
                            .documents("api::payment-collection.payment-collection")
                            .update({
                                documentId: paymentCollection.documentId,
                                data: {
                                    gatewayOrderId: result.result.orderId,
                                    paymentUrl: result.result.payment_url,
                                    gatewayResponse: result,
                                },
                            });


                    } catch (error) {

                        strapi.log.error("Payment Gateway Error:", error);

                        return ctx.badRequest("Unable to initialize payment.");

                    }

                    return ctx.send({
                        message: "Payment initiated successfully.",
                        paymentUrl,
                        paymentCollectionId: paymentCollection.documentId,
                    });
                }


                if (paymentMethod === "cod") {

                    // ===============================================
                    // Create Order
                    // ===============================================

                    const createdOrder = await strapi
                        .documents("api::order.order" as any)
                        .create({
                            data: {
                                orderNo,

                                ...(orderScheduleType === "pickup_delivery" && {
                                    pickupDate: cart.pickupDate,
                                    pickupTime: cart.pickupTime,
                                    deliveryDate: cart.deliveryDate,
                                    deliveryTime: cart.deliveryTime,
                                    delivery_address: cart.delivery_address?.documentId ?? null,
                                }),
                                ...(orderScheduleType === "appointment" && {
                                    appointmentDate: cart.appointmentDate,
                                    appointmentTime: cart.appointmentTime,
                                }),

                                paymentMethod,
                                paymentStatus: "pending",
                                orderStatus: "pending",

                                subTotal: Number((cart as any).subTotal),
                                tax: Number((cart as any).tax),
                                discount: Number((cart as any).discount),
                                deliveryCharge: Number((cart as any).deliveryCharge),
                                grandTotal: Number((cart as any).grandTotal),

                                specialInstruction: (cart as any).specialInstructions,

                                pickup_address: (cart as any).pickup_address?.documentId ?? null,

                                user_profile: userProfile.documentId,
                            },
                            transaction: trx,
                        });

                    let paymentCollection: any = null;

                    // ===============================================
                    // Create Order Items
                    // ===============================================

                    for (const item of (cart.cart_items as any[])) {
                        await strapi.documents("api::order-item.order-item").create({
                            data: {
                                order: createdOrder.documentId,

                                service: item.service.documentId,

                                service_varient: item.service_varient?.documentId ?? null,

                                service_pricing: item.service_pricing.documentId,

                                quantity: item.quantity,

                                unitPrice: item.unitPrice,

                                offerPrice: item.offerPrice,

                                expressDelivery: item.expressDelivery,

                                expressDeliveryPrice:
                                    item.expressDeliveryPrice,

                                totalPrice: item.totalPrice,

                                remarks: item.remarks,
                            },
                            transaction: trx,
                        });
                    }

                    // ===============================================
                    // Create Initial Order Status History
                    // ===============================================

                    await strapi.documents("api::order-status-history.order-status-history" as any).create({
                        data: {
                            order: createdOrder.documentId,
                            orderStatus: "pending",
                            updatedByType: "system",

                        },
                        transaction: trx,
                    });

                    // ===============================================
                    // Create Payment Collection 
                    // ===============================================
                    paymentCollection = await strapi
                        .documents("api::payment-collection.payment-collection")
                        .create({
                            data: {
                                order: createdOrder.documentId,
                                amount: Number((cart as any).grandTotal),
                                payment_status: "pending",
                            },
                            transaction: trx,
                        });

                    await trx.commit();

                    // ===============================================
                    // Return Complete Order
                    // ===============================================

                    const order = await strapi
                        .documents("api::order.order")
                        .findOne({
                            documentId: createdOrder.documentId,

                            populate: {
                                pickup_address: true,

                                delivery_address: true,

                                user_profile: true,

                                order_items: {
                                    populate: {
                                        service: true,
                                        service_varient: true,
                                        service_pricing: true,
                                    },
                                },
                            },
                        });

                    const emailItems = (cart as any).cart_items.map((item: any) => ({
                        serviceName: item.service?.name,
                        variantName: item.service_varient?.name,
                        quantity: item.quantity,
                        totalPrice: item.totalPrice,
                    }));

                    await sendOrderConfirmationEmail(
                        userProfile.email,
                        userProfile.fullName,
                        orderNo,
                        Number((cart as any).grandTotal),
                        paymentMethod,
                        emailItems
                    );

                    // ===============================================
                    // Clear Cart
                    // ===============================================

                    for (const item of (cart as any).cart_items) {
                        await strapi.documents("api::cart-item.cart-item").delete({
                            documentId: item.documentId,
                        });
                    }

                    await strapi.documents("api::cart.cart").delete({
                        documentId: (cart as any).documentId,
                    });

                    // ==========================================
                    // Create Notification
                    // ==========================================

                    await createNotification({
                        strapi,
                        title: "New Order Received",
                        description: `New order ${orderNo} has been received.`,
                        type: "order",
                    });

                    // ==========================================
                    // Emit New Order To Admin/Staff
                    // ==========================================

                    const io = getIO();

                    io.to("admin-orders").emit("order-created", {
                        order,
                    });

                    return ctx.send({
                        message: "Order created successfully.",
                        data: order,
                    });
                }


            } catch (error: any) {
                try {
                    await trx.rollback();
                } catch (_) {

                }

                strapi.log.error("Create Order Error:", error);

                return ctx.badRequest(
                    error?.message || "Failed to create order."
                );
            }
        },

        async find(ctx) {
            try {
                const user = ctx.state.user;

                if (!user) {
                    return ctx.unauthorized("You must be logged in.");
                }

                // ===============================================
                // Get Logged-in User with Role
                // ===============================================

                const loggedInUser = await strapi
                    .documents("plugin::users-permissions.user")
                    .findOne({
                        documentId: user.documentId,
                        populate: {
                            role: true,
                        },
                    });

                const roleName = loggedInUser?.role?.name;

                let filters: any = {};

                // ===============================================
                // Customer -> Only Own Orders
                // ===============================================

                if (roleName === "Customer") {
                    const userProfile = await strapi.db
                        .query("api::user-profile.user-profile")
                        .findOne({
                            where: {
                                users_permissions_user: user.id,
                            },
                        });

                    if (!userProfile) {
                        return ctx.badRequest(
                            "User profile not found."
                        );
                    }

                    filters = {
                        user_profile: {
                            documentId: {
                                $eq: userProfile.documentId,
                            },
                        },
                    };

                    const { orderType = "all" } = ctx.query;

                    if (orderType === "active") {
                        filters.orderStatus = {
                            $ne: "delivered",
                        };
                    } else if (orderType === "delivered") {
                        filters.orderStatus = {
                            $eq: "delivered",
                        };
                    } else if (orderType !== "all") {
                        return ctx.badRequest(
                            "Invalid orderType. Use all, active, or delivered."
                        );
                    }
                }

                // ===============================================
                // Admin / SuperAdmin -> All Orders
                // ===============================================

                else if (
                    roleName !== "Admin" &&
                    roleName !== "SuperAdmin"
                ) {
                    return ctx.forbidden(
                        "You are not allowed to access orders."
                    );
                }


                // ===============================================
                // Fetch Orders
                // ===============================================

                const orders = await strapi
                    .documents("api::order.order")
                    .findMany({
                        filters,
                        sort: ["createdAt:desc"],

                        populate: {
                            pickup_address: true,
                            delivery_address: true,
                            payment_collections: true,
                            user_profile: true,

                            delivery_driver: true,
                            pickup_driver: true,

                            order_items: {
                                populate: {
                                    service: true,
                                    service_varient: true,
                                    service_pricing: true,
                                },
                            },
                        },
                    });


                // ===============================================
                // CUSTOMER RESPONSE
                // ===============================================

                if (roleName === "Customer") {

                    const customerOrders = orders.map(
                        (order: any) => ({
                            documentId:
                                order.documentId,

                            orderNo: order.orderNo,

                            createdAt:
                                order.createdAt,

                            grandTotal:
                                order.grandTotal,

                            orderStatus:
                                order.orderStatus,

                            orderItems:
                                (order.order_items || []).map(
                                    (item: any) => ({
                                        quantity:
                                            item.quantity,

                                        serviceName:
                                            item.service?.name ||
                                            null,

                                        serviceVarientName:
                                            item.service_varient?.name ||
                                            null,
                                    })
                                ),
                        })
                    );

                    return ctx.send({
                        data: customerOrders,
                    });
                }


                // ===============================================
                // ADMIN / SUPERADMIN RESPONSE
                // ===============================================

                if (
                    roleName === "Admin" ||
                    roleName === "SuperAdmin"
                ) {

                    // ===========================================
                    // Customer Statistics
                    // ===========================================

                    const customerStats: Record<
                        string,
                        {
                            totalOrders: number;
                            totalSpend: number;
                        }
                    > = {};

                    for (const order of orders as any[]) {

                        const userProfileId =
                            order.user_profile?.documentId;

                        if (!userProfileId) {
                            continue;
                        }

                        if (!customerStats[userProfileId]) {
                            customerStats[userProfileId] = {
                                totalOrders: 0,
                                totalSpend: 0,
                            };
                        }

                        customerStats[userProfileId].totalOrders += 1;

                        const paidAmount = (
                            order.payment_collections || []
                        )
                            .filter(
                                (payment: any) =>
                                    payment.payment_status === "paid"
                            )
                            .reduce(
                                (total: number, payment: any) =>
                                    total + Number(payment.amount || 0),
                                0
                            );

                        customerStats[userProfileId].totalSpend += paidAmount;
                    }


                    // ===========================================
                    // Admin Orders
                    // ===========================================

                    const adminOrders = orders.map(
                        (order: any) => {

                            const userProfileId =
                                order.user_profile?.documentId;

                            const stats = userProfileId
                                ? customerStats[userProfileId]
                                : {
                                    totalOrders: 0,
                                    totalSpend: 0,
                                };

                            return {

                                documentId: order.documentId,

                                orderNo:
                                    order.orderNo,

                                orderStatus:
                                    order.orderStatus,

                                createdAt:
                                    order.createdAt,

                                paymentStatus:
                                    order.paymentStatus,

                                specialInstruction:
                                    order.specialInstruction,

                                pickupDate:
                                    order.pickupDate,

                                pickupTime:
                                    order.pickupTime,

                                deliveryDate:
                                    order.deliveryDate,

                                deliveryTime:
                                    order.deliveryTime,

                                grandTotal:
                                    order.grandTotal,


                                // -------------------------------
                                // Pickup Address
                                // -------------------------------

                                pickupAddress: {
                                    fullAddress:
                                        order.pickup_address
                                            ?.fullAddress ||
                                        null,
                                },


                                // -------------------------------
                                // Delivery Address
                                // -------------------------------

                                deliveryAddress: {
                                    fullAddress:
                                        order.delivery_address
                                            ?.fullAddress ||
                                        null,
                                },


                                // -------------------------------
                                // User
                                // -------------------------------

                                user: {

                                    fullName:
                                        order.user_profile
                                            ?.fullName ||
                                        null,

                                    email:
                                        order.user_profile
                                            ?.email ||
                                        null,

                                    phone:
                                        order.user_profile
                                            ?.phoneNumber ||
                                        null,

                                    totalOrders:
                                        stats.totalOrders,

                                    totalSpend:
                                        stats.totalSpend,
                                },


                                // -------------------------------
                                // Order Items
                                // -------------------------------

                                orderItems:
                                    (
                                        order.order_items ||
                                        []
                                    ).map(
                                        (item: any) => ({

                                            quantity:
                                                item.quantity,

                                            serviceName:
                                                item.service
                                                    ?.name ||
                                                null,

                                            serviceVarientName:
                                                item.service_varient
                                                    ?.name ||
                                                null,

                                            price:
                                                item.service_pricing
                                                    ?.price ??
                                                null,

                                            offerPrice:
                                                item.service_pricing
                                                    ?.offerPrice ??
                                                null,
                                        })
                                    ),


                                // -------------------------------
                                // Delivery Person
                                // -------------------------------

                                deliveryPerson: {
                                    documentId:
                                        order.delivery_driver?.documentId || null,
                                    fullName:
                                        order.delivery_driver
                                            ?.fullName ||
                                        null,
                                    phoneNumber:
                                        order.delivery_driver?.phoneNumber || null
                                },


                                // -------------------------------
                                // Pickup Person
                                // -------------------------------

                                pickupPerson: {
                                    documentId:
                                        order.pickup_driver?.documentId || null,
                                    fullName:
                                        order.pickup_driver
                                            ?.fullName ||
                                        null,
                                    phoneNumber:
                                        order.ppickup_driver?.phoneNumber || null
                                },
                            };
                        }
                    );


                    return ctx.send({
                        data: adminOrders,
                    });
                }

            } catch (error: any) {

                strapi.log.error(
                    "Find Orders Error:",
                    error
                );

                return ctx.badRequest(
                    error?.message ||
                    "Unable to fetch orders."
                );
            }
        },

        async findOne(ctx) {
            try {
                const user = ctx.state.user;

                if (!user) {
                    return ctx.unauthorized("You must be logged in.");
                }

                const { id } = ctx.params;

                if (!id) {
                    return ctx.badRequest("Order id is required.");
                }

                // ===============================================
                // Get Logged-in User with Role
                // ===============================================

                const loggedInUser = await strapi
                    .documents("plugin::users-permissions.user")
                    .findOne({
                        documentId: user.documentId,
                        populate: {
                            role: true,
                        },
                    });

                const roleName = loggedInUser?.role?.name;

                // ===============================================
                // Fetch Order
                // ===============================================

                const order = await strapi.documents("api::order.order").findOne({
                    documentId: id,
                    populate: {
                        pickup_address: true,
                        delivery_address: true,
                        user_profile: true,
                        order_items: {
                            populate: {
                                service: {
                                    populate: {
                                        image: true,
                                        service_category: true,
                                    },
                                },
                                service_varient: {
                                    populate: {
                                        image: true,
                                    },
                                },
                                service_pricing: true,
                            },
                        },
                    },
                });

                if (!order) {
                    return ctx.notFound("Order not found.");
                }

                // ===============================================
                // Customer -> Can Only View Own Order
                // ===============================================

                if (roleName === "Customer") {
                    const userProfile = await strapi.db
                        .query("api::user-profile.user-profile")
                        .findOne({
                            where: {
                                users_permissions_user: user.id,
                            },
                        });

                    if (!userProfile) {
                        return ctx.badRequest("User profile not found.");
                    }

                    if (
                        order.user_profile?.documentId !==
                        userProfile.documentId
                    ) {
                        return ctx.forbidden(
                            "You are not allowed to access this order."
                        );
                    }
                }
                // ===============================================
                // Admin / SuperAdmin -> Can View Any Order
                // ===============================================

                else if (
                    roleName !== "Admin" &&
                    roleName !== "SuperAdmin"
                ) {
                    return ctx.forbidden(
                        "You are not allowed to access this order."
                    );
                }

                return ctx.send({
                    data: order,
                });
            } catch (error: any) {
                strapi.log.error("Find Order Error:", error);

                return ctx.badRequest(
                    error?.message || "Unable to fetch order."
                );
            }
        },

        async update(ctx) {
            try {
                const user = ctx.state.user;

                if (!user) {
                    return ctx.unauthorized("You must be logged in.");
                }

                const { id } = ctx.params;

                if (!id) {
                    return ctx.badRequest("Order id is required.");
                }

                const body = ctx.request.body?.data || ctx.request.body;

                // ===============================================
                // Get Logged-in User with Role
                // ===============================================

                const loggedInUser = await strapi
                    .documents("plugin::users-permissions.user")
                    .findOne({
                        documentId: user.documentId,
                        populate: {
                            role: true,
                        },
                    });

                const roleName = loggedInUser?.role?.name;

                // ===============================================
                // Allow Only Admin / SuperAdmin
                // ===============================================

                if (
                    roleName !== "Admin" &&
                    roleName !== "SuperAdmin"
                ) {
                    return ctx.forbidden(
                        "Only Admin and SuperAdmin can update orders."
                    );
                }

                // ===============================================
                // Check Order Exists
                // ===============================================

                const existingOrder = await strapi
                    .documents("api::order.order")
                    .findOne({
                        documentId: id,
                    });

                if (!existingOrder) {
                    return ctx.notFound("Order not found.");
                }

                // ===============================================
                // Update Order
                // ===============================================

                const updatedOrder = await strapi
                    .documents("api::order.order")
                    .update({
                        documentId: id,
                        data: body,
                        populate: {
                            pickup_address: true,
                            delivery_address: true,
                            user_profile: true,
                            order_items: {
                                populate: {
                                    service: {
                                        populate: {
                                            image: true,
                                            service_category: true,
                                        },
                                    },
                                    service_varient: {
                                        populate: {
                                            image: true,
                                        },
                                    },
                                    service_pricing: true,
                                },
                            },
                        },
                    });

                return ctx.send({
                    message: "Order updated successfully.",
                    data: updatedOrder,
                });
            } catch (error: any) {
                strapi.log.error("Update Order Error:", error);

                return ctx.badRequest(
                    error?.message || "Unable to update order."
                );
            }
        },

        async delete(ctx) {
            try {
                const user = ctx.state.user;

                if (!user) {
                    return ctx.unauthorized("You must be logged in.");
                }

                const { id } = ctx.params;

                if (!id) {
                    return ctx.badRequest("Order id is required.");
                }

                // ===============================================
                // Get Logged-in User with Role
                // ===============================================

                const loggedInUser = await strapi
                    .documents("plugin::users-permissions.user")
                    .findOne({
                        documentId: user.documentId,
                        populate: {
                            role: true,
                        },
                    });

                const roleName = loggedInUser?.role?.name;

                // ===============================================
                // Allow Only Admin / SuperAdmin
                // ===============================================

                if (
                    roleName !== "Admin" &&
                    roleName !== "SuperAdmin"
                ) {
                    return ctx.forbidden(
                        "Only Admin and SuperAdmin can delete orders."
                    );
                }

                // ===============================================
                // Fetch Order
                // ===============================================

                const order = await strapi.documents("api::order.order").findOne({
                    documentId: id,
                    populate: {
                        order_items: true,
                    },
                });

                if (!order) {
                    return ctx.notFound("Order not found.");
                }

                // ===============================================
                // Delete Related Order Items
                // ===============================================

                if (order.order_items?.length) {
                    for (const item of order.order_items) {
                        await strapi.documents("api::order-item.order-item").delete({
                            documentId: item.documentId,
                        });
                    }
                }

                // ===============================================
                // Delete Order
                // ===============================================

                await strapi.documents("api::order.order").delete({
                    documentId: id,
                });

                return ctx.send({
                    message: "Order deleted successfully.",
                });
            } catch (error: any) {
                strapi.log.error("Delete Order Error:", error);

                return ctx.badRequest(
                    error?.message || "Unable to delete order."
                );
            }
        }

    })
);