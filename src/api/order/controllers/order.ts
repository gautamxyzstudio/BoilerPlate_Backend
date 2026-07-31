/**
 * order controller
 */

import { factories } from "@strapi/strapi";
import crypto from "crypto";

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

                const {
                    pickupDate,
                    pickupTime,
                    deliveryDate,
                    deliveryTime,

                    appointmentDate,
                    appointmentTime,

                    paymentMethod,
                    pickup_address,
                    delivery_address,
                    specialInstruction,
                    items,
                } = body;

                // ===============================
                // Validate Required Fields
                // ===============================

                if (!paymentMethod) {
                    return ctx.badRequest("Payment method is required.");
                }

                const allowedPaymentMethods = [
                    "upi",
                    "credit/debit card",
                    "netbanking",
                    "cod",
                ];

                if (!allowedPaymentMethods.includes(paymentMethod)) {
                    return ctx.badRequest("Invalid payment method.");
                }

                if (!pickup_address) {
                    return ctx.badRequest("Pickup address is required.");
                }

                if (!Array.isArray(items) || items.length === 0) {
                    return ctx.badRequest(
                        "At least one order item is required."
                    );
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

                // ===============================
                // Validate Pickup Address
                // ===============================

                const pickupAddress = await strapi
                    .documents("api::address.address")
                    .findOne({
                        documentId: pickup_address,
                        populate: {
                            users_permissions_user: true,
                        },
                    });

                if (!pickupAddress) {
                    return ctx.badRequest("Pickup address not found.");
                }

                // ===============================
                // Validate Delivery Address (If Provided)
                // ===============================

                let deliveryAddress = null;

                if (delivery_address) {
                    deliveryAddress = await strapi
                        .documents("api::address.address")
                        .findOne({
                            documentId: delivery_address,
                            populate: {
                                users_permissions_user: true,
                            },
                        });

                    if (!deliveryAddress) {
                        return ctx.badRequest("Delivery address not found.");
                    }
                }

                // ===============================
                // Ensure Addresses Belong
                // To Logged-in User
                // ===============================

                if (pickupAddress.users_permissions_user?.id !== user.id) {
                    return ctx.forbidden(
                        "You are not allowed to use this pickup address."
                    );
                }

                if (
                    deliveryAddress &&
                    deliveryAddress.users_permissions_user?.id !== user.id
                ) {
                    return ctx.forbidden(
                        "You are not allowed to use this delivery address."
                    );
                }

                // ===============================
                // Validate Order Items
                // ===============================

                const uniqueItems = new Set();

                for (const item of items) {
                    const key = `${item.service}-${item.service_varient || "flat"}`;

                    if (uniqueItems.has(key)) {
                        return ctx.badRequest(
                            "Duplicate service/variant found. Please combine quantities."
                        );
                    }

                    uniqueItems.add(key);
                }

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


                let orderScheduleType: "pickup_delivery" | "appointment" | null = null;
                // ===============================================
                // Validate Services & Calculate Item Prices
                // ===============================================

                let subTotal = 0;

                const preparedOrderItems: any[] = [];

                for (const item of items) {
                    // ===============================================
                    // Fetch Service
                    // ===============================================

                    const service = await strapi.documents("api::service.service").findOne({
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
                        throw new Error("Service not found.");
                    }

                    const scheduleType = service.scheduleType;

                    if (!scheduleType) {
                        throw new Error(`Schedule type is not configured for "${service.name}".`);
                    }

                    if (!orderScheduleType) {
                        orderScheduleType = scheduleType as
                            | "pickup_delivery"
                            | "appointment";
                    } else if (orderScheduleType !== scheduleType) {
                        throw new Error(
                            "All services in an order must have the same schedule type."
                        );
                    }

                    let pricing: any = null;
                    let variant: any = null;

                    // ===============================================
                    // Flat Pricing
                    // ===============================================

                    if (service.pricingModel === "flat") {
                        pricing = service.service_pricings?.[0];

                        if (!pricing) {
                            throw new Error(
                                `Pricing not found for service "${service.name}".`
                            );
                        }
                    }

                    // ===============================================
                    // Variant Pricing
                    // ===============================================

                    else if (service.pricingModel === "variant") {
                        if (!item.service_varient) {
                            throw new Error(
                                `Variant is required for service "${service.name}".`
                            );
                        }

                        variant = service.service_varients?.find(
                            (v: any) => v.documentId === item.service_varient
                        );

                        if (!variant) {
                            throw new Error(
                                `Variant not found for service "${service.name}".`
                            );
                        }

                        pricing = variant.service_pricings?.[0];

                        if (!pricing) {
                            throw new Error(
                                `Pricing not found for variant "${variant.name}".`
                            );
                        }
                    }

                    else {
                        throw new Error("Invalid pricing model.");
                    }

                    // ===============================================
                    // Determine Effective Price
                    // ===============================================

                    if (pricing.price == null) {
                        throw new Error(
                            `Price not configured for "${service.name}".`
                        );
                    }

                    const unitPrice = Number(pricing.price);

                    if (
                        pricing.offerPrice != null &&
                        Number(pricing.offerPrice) > unitPrice
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
                        offerPrice !== null ? offerPrice : unitPrice;

                    const expressDeliveryPrice = Number(
                        pricing.expressDeliveryPrice || 0
                    );

                    const quantity = Number(item.quantity);

                    // ===============================================
                    // Calculate Item Total
                    // ===============================================

                    let itemTotal = effectivePrice * quantity;

                    if (item.expressDelivery) {
                        itemTotal += expressDeliveryPrice * quantity;
                    }

                    // ===============================================
                    // Add to Subtotal
                    // ===============================================

                    itemTotal = Number(itemTotal.toFixed(2));

                    subTotal += itemTotal;

                    // ===============================================
                    // Prepare Order Item
                    // ===============================================

                    preparedOrderItems.push({
                        service: service.documentId,
                        service_varient: variant?.documentId || null,
                        service_pricing: pricing.documentId,
                        quantity,
                        unitPrice,
                        offerPrice,
                        expressDelivery: !!item.expressDelivery,
                        expressDeliveryPrice: item.expressDelivery
                            ? expressDeliveryPrice
                            : 0,
                        totalPrice: itemTotal,
                        remarks: item.remarks || null,
                    });
                }

                if (orderScheduleType === "pickup_delivery") {
                    if (!pickupDate) {
                        throw new Error("Pickup date is required.");
                    }

                    if (!pickupTime) {
                        throw new Error("Pickup time is required.");
                    }

                    if (!deliveryDate) {
                        throw new Error("Delivery date is required.");
                    }

                    if (!deliveryTime) {
                        throw new Error("Delivery time is required.");
                    }

                    if (!delivery_address) {
                        throw new Error("Delivery address is required.");
                    }
                }

                if (orderScheduleType === "appointment") {
                    if (!appointmentDate) {
                        throw new Error("Appointment date is required.");
                    }

                    if (!appointmentTime) {
                        throw new Error("Appointment time is required.");
                    }
                }

                // ===============================================
                // Calculate Totals & Create Order
                // ===============================================

                const tax = 0;
                const discount = 0;
                const deliveryCharge = 0;

                subTotal = Number(subTotal.toFixed(2));

                const grandTotal = Number(
                    (
                        subTotal +
                        tax +
                        deliveryCharge -
                        discount
                    ).toFixed(2)
                );

                // ===============================================
                // Create Order
                // ===============================================

                const createdOrder = await strapi
                    .documents("api::order.order")
                    .create({
                        data: {
                            orderNo,

                            ...(orderScheduleType === "pickup_delivery" && {
                                pickupDate,
                                pickupTime,
                                deliveryDate,
                                deliveryTime,
                                delivery_address,
                            }),

                            ...(orderScheduleType === "appointment" && {
                                appointmentDate,
                                appointmentTime,
                            }),

                            paymentMethod,
                            paymentStatus: "pending",
                            orderStatus: "pending",

                            subTotal,
                            tax,
                            discount,
                            deliveryCharge,
                            grandTotal,

                            specialInstruction,

                            pickup_address,

                            user_profile: userProfile.documentId,
                        },
                        transaction: trx,
                    });

                // ===============================================
                // Create Order Items
                // ===============================================

                for (const item of preparedOrderItems) {
                    await strapi.documents("api::order-item.order-item").create({
                        data: {
                            order: createdOrder.documentId,

                            service: item.service,

                            service_varient: item.service_varient,

                            service_pricing: item.service_pricing,

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
                // Commit Transaction
                // ===============================================

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

                return ctx.send({
                    message: "Order created successfully.",
                    data: order,
                });

            } catch (error: any) {
                await trx.rollback();

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

                let filters = {};

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
                        return ctx.badRequest("User profile not found.");
                    }

                    filters = {
                        user_profile: {
                            documentId: {
                                $eq: userProfile.documentId,
                            },
                        },
                    };
                }
                // ===============================================
                // Admin / SuperAdmin -> All Orders
                // ===============================================

                else if (
                    roleName !== "Admin" &&
                    roleName !== "SuperAdmin"
                ) {
                    return ctx.forbidden("You are not allowed to access orders.");
                }

                // ===============================================
                // Fetch Orders
                // ===============================================

                const orders = await strapi.documents("api::order.order").findMany({
                    filters,
                    sort: ["createdAt:desc"],
                    populate: {
                        pickup_address: true,
                        delivery_address: true,
                        user_profile: {
                            populate: {
                                users_permissions_user: true,
                            },
                        },
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
                    message: "Orders fetched successfully.",
                    data: orders,
                });
            } catch (error: any) {
                strapi.log.error("Find Orders Error:", error);

                return ctx.badRequest(
                    error?.message || "Unable to fetch orders."
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
                    message: "Order fetched successfully.",
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