/**
 * cart controller
 */

import { factories } from "@strapi/strapi";
import service from "../../service/services/service";

export default factories.createCoreController(
  "api::cart.cart",
  ({ strapi }) => ({
  
    async create(ctx) {
      try {
        // ===============================================
        // 1. Auth & Body Validation
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

        if (!Array.isArray(items) || items.length === 0) {
          return ctx.badRequest("At least one cart item is required.");
        }

        // Quick duplicate check
        const uniqueItems = new Set<string>();
        for (const item of items) {
          if (!item.service) {
            return ctx.badRequest("Service is required for every cart item.");
          }
          if (!item.quantity || Number(item.quantity) < 1) {
            return ctx.badRequest("Quantity must be at least 1.");
          }
          const key = `${item.service}-${item.service_varient || "flat"}`;
          if (uniqueItems.has(key)) {
            return ctx.badRequest(
              "Duplicate service/variant found. Please combine quantities.",
            );
          }
          uniqueItems.add(key);
        }

        // ===============================================
        // 2. Parallel Lookups: Profile, Addresses
        // ===============================================
        const [userProfile, pickupAddress, deliveryAddress] = await Promise.all(
          [
            strapi.db.query("api::user-profile.user-profile").findOne({
              where: { users_permissions_user: user.id },
              select: ["id", "documentId"],
            }),
            pickup_address
              ? strapi.documents("api::address.address").findOne({
                  documentId: pickup_address,
                  populate: { user_profile: { fields: ["documentId"] } },
                })
              : null,
            delivery_address
              ? strapi.documents("api::address.address").findOne({
                  documentId: delivery_address,
                  populate: { user_profile: { fields: ["documentId"] } },
                })
              : null,
          ],
        );

        if (!userProfile) {
          return ctx.badRequest("User profile not found.");
        }

        if (pickup_address) {
          if (!pickupAddress)
            return ctx.badRequest("Pickup address not found.");
          if (
            pickupAddress.user_profile?.documentId !== userProfile.documentId
          ) {
            return ctx.forbidden("Pickup address does not belong to you.");
          }
        }

        if (delivery_address) {
          if (!deliveryAddress)
            return ctx.badRequest("Delivery address not found.");
          if (
            deliveryAddress.user_profile?.documentId !== userProfile.documentId
          ) {
            return ctx.forbidden("Delivery address does not belong to you.");
          }
        }

        // ===============================================
        // 3. Batch Fetch All Required Services in ONE Query
        // ===============================================
        const serviceDocIds = Array.from(
          new Set(items.map((i: any) => i.service)),
        );
        const servicesList = await strapi
          .documents("api::service.service")
          .findMany({
            filters: {
              documentId: { $in: serviceDocIds },
            },
            fields: ["documentId", "name", "scheduleType", "pricingModel"],
            populate: {
              service_pricings: {
                fields: [
                  "documentId",
                  "price",
                  "offerPrice",
                  "expressDeliveryPrice",
                  "createdAt",
                ],
              },
              service_varients: {
                fields: ["documentId", "name"],
                populate: {
                  service_pricings: {
                    fields: [
                      "documentId",
                      "price",
                      "offerPrice",
                      "expressDeliveryPrice",
                      "createdAt",
                    ],
                  },
                },
              },
            },
          });

        const servicesMap = new Map<string, any>(
          servicesList.map((s: any) => [s.documentId, s]),
        );

        // ===============================================
        // 4. Calculate Prices & Validate In-Memory
        // ===============================================
        let subTotal = 0;
        const preparedCartItems: any[] = [];
        let scheduleType: string | null = null;

        for (const item of items) {
          const service = servicesMap.get(item.service);
          if (!service) {
            return ctx.badRequest(`Service not found: ${item.service}`);
          }

          if (!scheduleType) {
            scheduleType = service.scheduleType;
          }

          let pricing: any = null;
          let variant: any = null;

          if (service.pricingModel === "flat") {
            pricing = service.service_pricings?.[0];
            if (!pricing) {
              return ctx.badRequest(
                `Pricing not found for service "${service.name}".`,
              );
            }
          } else if (service.pricingModel === "variant") {
            if (!item.service_varient) {
              return ctx.badRequest(
                `Variant is required for service "${service.name}".`,
              );
            }
            variant = service.service_varients?.find(
              (v: any) => v.documentId === item.service_varient,
            );
            if (!variant) {
              return ctx.badRequest(
                `Variant not found for service "${service.name}".`,
              );
            }
            pricing = variant.service_pricings?.[0];
            if (!pricing) {
              return ctx.badRequest(
                `Pricing not found for variant "${variant.name}".`,
              );
            }
          } else {
            return ctx.badRequest("Invalid pricing model.");
          }

          if (pricing.price == null) {
            return ctx.badRequest(
              `Price not configured for "${service.name}".`,
            );
          }

          const unitPrice = Number(pricing.price);
          if (
            pricing.offerPrice != null &&
            Number(pricing.offerPrice) > unitPrice
          ) {
            return ctx.badRequest(
              `Offer price cannot be greater than regular price for "${service.name}".`,
            );
          }

          const offerPrice =
            pricing.offerPrice != null ? Number(pricing.offerPrice) : null;
          const effectivePrice = offerPrice !== null ? offerPrice : unitPrice;
          const expressDeliveryPrice = Number(
            pricing.expressDeliveryPrice || 0,
          );
          const quantity = Number(item.quantity);

          let itemTotal = effectivePrice * quantity;
          if (item.expressDelivery) {
            itemTotal += expressDeliveryPrice * quantity;
          }
          itemTotal = Number(itemTotal.toFixed(2));
          subTotal += itemTotal;

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
        // 5. Validate Schedule Type
        // ===============================================
        if (scheduleType === "pickup_delivery") {
          if (!pickup_address)
            return ctx.badRequest("Pickup address is required.");
          if (!delivery_address)
            return ctx.badRequest("Delivery address is required.");
          if (!pickupDate) return ctx.badRequest("Pickup date is required.");
          if (!pickupTime) return ctx.badRequest("Pickup time is required.");
          if (!deliveryDate)
            return ctx.badRequest("Delivery date is required.");
          if (!deliveryTime)
            return ctx.badRequest("Delivery time is required.");
        } else if (scheduleType === "appointment") {
          if (!pickup_address)
            return ctx.badRequest("Pickup address is required.");
          if (!appointmentDate)
            return ctx.badRequest("Appointment date is required.");
          if (!appointmentTime)
            return ctx.badRequest("Appointment time is required.");
        }

        const tax = 0;
        const discount = 0;
        const deliveryCharge = 0;
        const grandTotal = Number(
          (subTotal + tax + deliveryCharge - discount).toFixed(2),
        );

        // ===============================================
        // 6. Check Existing Cart & Run DB Writes
        // ===============================================
        const existingCart = await strapi
          .documents("api::cart.cart")
          .findFirst({
            filters: {
              user_profile: {
                documentId: userProfile.documentId,
              },
            },
            fields: ["documentId"],
          });

        const isNewCart = !existingCart;

        const cartData = {
          user_profile: userProfile.documentId,
          pickup_address: pickup_address || null,
          delivery_address: delivery_address || null,
          pickupDate: pickupDate || null,
          pickupTime: pickupTime || null,
          deliveryDate: deliveryDate || null,
          deliveryTime: deliveryTime || null,
          appointmentDate: appointmentDate || null,
          appointmentTime: appointmentTime || null,
          specialInstructions: specialInstructions || null,
          subTotal,
          tax,
          discount,
          deliveryCharge,
          grandTotal,
        };

        let cartDocId: string;

        if (isNewCart) {
          const newCart = await strapi.documents("api::cart.cart").create({
            data: cartData,
          });
          cartDocId = newCart.documentId;
        } else {
          cartDocId = existingCart.documentId;

          // Single-query delete for old items
          await strapi.db.query("api::cart-item.cart-item").deleteMany({
            where: {
              cart: {
                documentId: cartDocId,
              },
            },
          });

          await strapi.documents("api::cart.cart").update({
            documentId: cartDocId,
            data: cartData,
          });
        }

        // Parallel insert for all cart items
        await Promise.all(
          preparedCartItems.map((item) =>
            strapi.documents("api::cart-item.cart-item").create({
              data: {
                cart: cartDocId,
                service: item.service,
                service_varient: item.service_varient,
                service_pricing: item.service_pricing,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                offerPrice: item.offerPrice,
                expressDelivery: item.expressDelivery,
                expressDeliveryPrice: item.expressDeliveryPrice,
                totalPrice: item.totalPrice,
                remarks: item.remarks,
              },
            }),
          ),
        );

        // ===============================================
        // 7. Format & Return Response
        // ===============================================
        const response: any = {
          grandTotal,
          cartItems: preparedCartItems.map((item: any) => ({
            quantity: item.quantity,
            totalPrice: item.totalPrice,
            service: { name: item.serviceName },
            serviceVariant: item.variantName
              ? { name: item.variantName }
              : null,
          })),
        };

        if (scheduleType === "pickup_delivery") {
          response.pickupAddress = pickupAddress
            ? { fullAddress: pickupAddress.fullAddress }
            : null;
          response.pickupDate = pickupDate || null;
          response.pickupTime = pickupTime || null;
          response.deliveryDate = deliveryDate || null;
          response.deliveryTime = deliveryTime || null;
        } else if (scheduleType === "appointment") {
          response.pickupAddress = pickupAddress
            ? { fullAddress: pickupAddress.fullAddress }
            : null;
          response.appointmentDate = appointmentDate || null;
          response.appointmentTime = appointmentTime || null;
        }

        return ctx.send({
          message: isNewCart
            ? "Cart created successfully."
            : "Cart updated successfully.",
          data: response,
        });
      } catch (error: any) {
        strapi.log.error("Create Cart Error:", error);
        return ctx.badRequest(error?.message || "Failed to update cart.");
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

        const cart = await strapi.documents("api::cart.cart").findFirst({
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

        return ctx.badRequest(error?.message || "Failed to fetch cart.");
      }
    },
  }),
);
