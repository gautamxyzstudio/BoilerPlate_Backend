/**
 * cart controller
 */

import { factories } from '@strapi/strapi';
import service from '../../service/services/service';

export default factories.createCoreController(
    "api::cart.cart",
    ({ strapi }) => ({

        async create(ctx) {

            let trx;

            try {
                // ===============================================
                // Logged-in User
                // ===============================================

                const user = ctx.state.user;

                if (!user) {
                    return ctx.unauthorized("You must be logged in.");
                }

                const body = ctx.request.body?.data || ctx.request.body || {};

                const {
                    items,
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
                // Validate Required Fields
                // ===============================================

                if (!Array.isArray(items) || items.length === 0) {
                    return ctx.badRequest(
                        "At least one cart item is required."
                    );
                }

                // ===============================================
                // Get Logged-in User Profile
                // ===============================================

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
                // Validate Pickup Address
                // ===============================================

                let pickupAddress = null;

                if (pickup_address) {
                    pickupAddress = await strapi
                        .documents("api::address.address")
                        .findOne({
                            documentId: pickup_address,
                            populate: {
                                user_profile: true,
                            },
                        });

                    if (!pickupAddress) {

                        return ctx.badRequest("Pickup address not found.");
                    }

                    if (
                        pickupAddress.user_profile?.documentId !==
                        userProfile.documentId
                    ) {

                        return ctx.forbidden(
                            "Pickup address does not belong to you."
                        );
                    }
                }

                // ===============================================
                // Validate Delivery Address
                // ===============================================

                let deliveryAddress = null;

                if (delivery_address) {
                    deliveryAddress = await strapi
                        .documents("api::address.address")
                        .findOne({
                            documentId: delivery_address,
                            populate: {
                                user_profile: true,
                            },
                        });

                    if (!deliveryAddress) {

                        return ctx.badRequest("Delivery address not found.");
                    }

                    if (
                        deliveryAddress.user_profile?.documentId !==
                        userProfile.documentId
                    ) {

                        return ctx.forbidden(
                            "Delivery address does not belong to you."
                        );
                    }
                }

                // ===============================================
                // Validate Duplicate Items
                // ===============================================

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

                // ===============================================
                // Validate Item Data
                // ===============================================

                for (const item of items) {
                    if (!item.service) {
                        return ctx.badRequest(
                            "Service is required for every cart item."
                        );
                    }

                    if (!item.quantity || Number(item.quantity) < 1) {
                        return ctx.badRequest(
                            "Quantity must be at least 1."
                        );
                    }
                }

                // ===============================================
                // Validate Services & Calculate Prices
                // ===============================================

                trx = await strapi.db.transaction();

                let subTotal = 0;

                const preparedCartItems: any[] = [];
                let scheduleType: string | null = null;

                for (const item of items) {

                    // ===============================================
                    // Fetch Service
                    // ===============================================

                    const service: any = await strapi.documents("api::service.service").findOne({
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

                    if (!scheduleType) {
                        scheduleType = service.scheduleType;
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

                    preparedCartItems.push({
                        service: service.documentId,
                        serviceName: service.name,

                        service_varient: variant?.documentId || null,
                        variantName: variant?.name || null,

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

                // ===============================================
                // Validate Schedule
                // ===============================================

                if (scheduleType === "pickup_delivery") {

                    if (!pickup_address) {

                        return ctx.badRequest("Pickup address is required.");
                    }

                    if (!delivery_address) {

                        return ctx.badRequest("Delivery address is required.");
                    }

                    if (!pickupDate) {

                        return ctx.badRequest("Pickup date is required.");
                    }

                    if (!pickupTime) {

                        return ctx.badRequest("Pickup time is required.");
                    }

                    if (!deliveryDate) {

                        return ctx.badRequest("Delivery date is required.");
                    }

                    if (!deliveryTime) {

                        return ctx.badRequest("Delivery time is required.");
                    }
                }

                if (scheduleType === "appointment") {

                    if (!pickup_address) {

                        return ctx.badRequest("Pickup address is required.");
                    }

                    if (!appointmentDate) {

                        return ctx.badRequest("Appointment date is required.");
                    }

                    if (!appointmentTime) {

                        return ctx.badRequest("Appointment time is required.");
                    }
                }

                // ===============================================
                // Find Existing Cart
                // ===============================================

                let isNewCart = false;

                let cart = await strapi
                    .documents("api::cart.cart")
                    .findFirst({
                        filters: {
                            user_profile: {
                                documentId: userProfile.documentId,
                            },
                        },
                        populate: {
                            cart_items: {
                                populate: {
                                    service: true,
                                    service_varient: true,
                                    service_pricing: true,
                                },
                            },
                        },
                    });

                // ===============================================
                // Create Cart If Doesn't Exist
                // ===============================================

                if (!cart) {

                    isNewCart = true;

                    cart = await strapi
                        .documents("api::cart.cart")
                        .create({
                            data: {
                                user_profile: userProfile.documentId,
                                pickup_address,
                                delivery_address,

                                pickupDate,
                                pickupTime,

                                deliveryDate,
                                deliveryTime,

                                appointmentDate,
                                appointmentTime,

                                specialInstructions,
                                subTotal: 0,
                                tax: 0,
                                discount: 0,
                                deliveryCharge: 0,
                                grandTotal: 0,
                            },
                            transaction: trx,
                        });
                }

                // ===============================================
                // Delete Existing Cart Items
                // ===============================================

                if (!isNewCart) {
                    const existingCartItems = await strapi
                        .documents("api::cart-item.cart-item")
                        .findMany({
                            filters: {
                                cart: {
                                    documentId: cart.documentId,
                                },
                            },
                        });

                    await Promise.all(
                        existingCartItems.map((item: any) =>
                            strapi.documents("api::cart-item.cart-item").delete({
                                documentId: item.documentId,
                            })
                        )
                    );
                }

                // ===============================================
                // Create Cart Items
                // ===============================================

                for (const item of preparedCartItems) {

                    await strapi
                        .documents("api::cart-item.cart-item")
                        .create({
                            data: {
                                cart: cart.documentId,

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
                // Fetch Updated Cart Items
                // ===============================================

                const cartItems = await strapi
                    .documents("api::cart-item.cart-item")
                    .findMany({
                        filters: {
                            cart: {
                                documentId: cart.documentId,
                            },
                        },
                    });

                subTotal = 0;

                for (const item of cartItems) {
                    subTotal += Number(item.totalPrice || 0);
                }

                subTotal = Number(subTotal.toFixed(2));

                // ===============================================
                // Calculate Cart Totals
                // ===============================================

                const tax = 0;
                const discount = 0;
                const deliveryCharge = 0;

                const grandTotal = Number(
                    (
                        subTotal +
                        tax +
                        deliveryCharge -
                        discount
                    ).toFixed(2)
                );

                // ===============================================
                // Update Cart
                // ===============================================

                await strapi.documents("api::cart.cart").update({
                    documentId: cart.documentId,
                    data: {
                        subTotal,
                        pickup_address: pickup_address || null,
                        delivery_address: delivery_address || null,

                        pickupDate: pickupDate || null,
                        pickupTime: pickupTime || null,

                        deliveryDate: deliveryDate || null,
                        deliveryTime: deliveryTime || null,

                        appointmentDate: appointmentDate || null,
                        appointmentTime: appointmentTime || null,

                        specialInstructions: specialInstructions || null,
                        tax,
                        discount,
                        deliveryCharge,
                        grandTotal,
                    },
                    transaction: trx,
                });

                // ===============================================
                // Commit Transaction
                // ===============================================

                await trx.commit();
                trx = null;

                // ===============================================
                // Return Populated Cart
                // ===============================================

                const populatedCart = await strapi
                    .documents("api::cart.cart")
                    .findOne({
                        documentId: cart.documentId,
                        populate: {
                            pickup_address: true,

                            delivery_address: true,

                            user_profile: true,

                            cart_items: {
                                populate: {
                                    service: true,
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

                if (!populatedCart) {
                    return ctx.notFound("Cart not found.");
                }

                const cartData: any = populatedCart;

                const response = {
                    documentId: cartData.documentId,
                    createdAt: cartData.createdAt,

                    subTotal: cartData.subTotal,
                    tax: cartData.tax,
                    discount: cartData.discount,
                    deliveryCharge: cartData.deliveryCharge,
                    grandTotal: cartData.grandTotal,
                    pickupAddress: cartData.pickup_address
                        ? {
                            documentId: cartData.pickup_address.documentId,
                            addressType: cartData.pickup_address.addressType,
                            streetAddress: cartData.pickup_address.streetAddress,
                            fullAddress: cartData.pickup_address.fullAddress,
                            city: cartData.pickup_address.city,
                            state: cartData.pickup_address.state,
                            postalCode: cartData.pickup_address.postalCode,
                        }
                        : null,

                    deliveryAddress: cartData.delivery_address
                        ? {
                            documentId: cartData.delivery_address.documentId,
                            addressType: cartData.delivery_address.addressType,
                            streetAddress: cartData.delivery_address.streetAddress,
                            fullAddress: cartData.delivery_address.fullAddress,
                            city: cartData.delivery_address.city,
                            state: cartData.delivery_address.state,
                            postalCode: cartData.delivery_address.postalCode,
                        }
                        : null,

                    pickupDate: cartData.pickupDate,
                    pickupTime: cartData.pickupTime,

                    deliveryDate: cartData.deliveryDate,
                    deliveryTime: cartData.deliveryTime,

                    appointmentDate: cartData.appointmentDate,
                    appointmentTime: cartData.appointmentTime,

                    specialInstructions: cartData.specialInstructions,
                    cartItems: (cartData.cart_items ?? []).map((item: any) => ({
                        documentId: item.documentId,

                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        offerPrice: item.offerPrice,
                        totalPrice: item.totalPrice,

                        expressDelivery: item.expressDelivery,
                        expressDeliveryPrice: item.expressDeliveryPrice,

                        remarks: item.remarks,

                        service: {
                            documentId: item.service.documentId,
                            name: item.service.name,
                            pricingModel: item.service.pricingModel,
                            scheduleType: item.service.scheduleType,
                        },

                        serviceVariant: item.service_varient
                            ? {
                                documentId: item.service_varient.documentId,
                                name: item.service_varient.name,
                                expressDeliveryAvailable:
                                    item.service_varient.expressDeliveryAvailable,
                                image: item.service_varient.image?.url ?? null,
                            }
                            : null,

                        servicePricing: item.service_pricing
                            ? {
                                documentId: item.service_pricing.documentId,
                                price: item.service_pricing.price,
                                offerPrice: item.service_pricing.offerPrice,
                                expressDeliveryPrice:
                                    item.service_pricing.expressDeliveryPrice,
                            }
                            : null,
                    })),
                };

                return ctx.send({
                    message: isNewCart
                        ? "Cart created successfully."
                        : "Cart updated successfully.",
                    data: response,
                });

            } catch (error: any) {

                if (trx) {
                    await trx.rollback();
                }

                strapi.log.error("Create Cart Error:", error);

                return ctx.badRequest(
                    error?.message || "Failed to update cart."
                );
            }
        },

        async getMyCart(ctx) {
            try {
                // ===============================================
                // Logged-in User
                // ===============================================

                const user = ctx.state.user;

                if (!user) {
                    return ctx.unauthorized("You must be logged in.");
                }

                // ===============================================
                // Get User Profile
                // ===============================================

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
                // Find User Cart
                // ===============================================

                const cart = await strapi
                    .documents("api::cart.cart")
                    .findFirst({
                        filters: {
                            user_profile: {
                                documentId: userProfile.documentId,
                            },
                        },
                        populate: {
                            cart_items: {
                                populate: {
                                    service: true,
                                    service_varient: {
                                        populate: {
                                            image: true, // Replace "image" with your media field name if different
                                        },
                                    },
                                    service_pricing: true,
                                },
                            },
                        },
                    });

                // ===============================================
                // Empty Cart
                // ===============================================

                if (!cart) {
                    return ctx.send({
                        message: "Cart is empty.",
                        data: {
                            documentId: null,
                            createdAt: null,
                            subTotal: 0,
                            tax: 0,
                            discount: 0,
                            deliveryCharge: 0,
                            grandTotal: 0,
                            cartItems: [],
                        },
                    });
                }

                // ===============================================
                // Build Response
                // ===============================================

                const cartData: any = cart;

                const response = {
                    documentId: cartData.documentId,
                    createdAt: cartData.createdAt,

                    subTotal: cartData.subTotal,
                    tax: cartData.tax,
                    discount: cartData.discount,
                    deliveryCharge: cartData.deliveryCharge,
                    grandTotal: cartData.grandTotal,

                    cartItems: (cartData.cart_items || []).map((item: any) => ({
                        documentId: item.documentId,

                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        offerPrice: item.offerPrice,
                        totalPrice: item.totalPrice,

                        expressDelivery: item.expressDelivery,
                        expressDeliveryPrice: item.expressDeliveryPrice,

                        remarks: item.remarks,

                        service: {
                            documentId: item.service.documentId,
                            name: item.service.name,
                            pricingModel: item.service.pricingModel,
                            scheduleType: item.service.scheduleType,
                        },

                        serviceVariant: item.service_varient
                            ? {
                                documentId: item.service_varient.documentId,
                                name: item.service_varient.name,
                                expressDeliveryAvailable:
                                    item.service_varient.expressDeliveryAvailable,
                                image: item.service_varient.image?.url ?? null,
                            }
                            : null,

                        servicePricing: item.service_pricing
                            ? {
                                documentId: item.service_pricing.documentId,
                                price: item.service_pricing.price,
                                offerPrice: item.service_pricing.offerPrice,
                                expressDeliveryPrice:
                                    item.service_pricing.expressDeliveryPrice,
                            }
                            : null,
                    })),
                };

                return ctx.send({
                    message: "Cart fetched successfully.",
                    data: response,
                });
            } catch (error: any) {
                strapi.log.error("Get Cart Error:", error);

                return ctx.badRequest(
                    error?.message || "Failed to fetch cart."
                );
            }
        },

    })
);

