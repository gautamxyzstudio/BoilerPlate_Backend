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
      try {
        // ===============================================
        // 1. Auth & Body Validation
        // ===============================================
        const user = ctx.state.user;
        if (!user) {
          return ctx.unauthorized("You must be logged in.");
        }

        const body = ctx.request.body?.data || ctx.request.body || {};
        const { paymentMethod } = body;

        if (!paymentMethod) {
          return ctx.badRequest("Payment method is required.");
        }

        const allowedPaymentMethods = ["online", "cod"];
        if (!allowedPaymentMethods.includes(paymentMethod)) {
          return ctx.badRequest("Invalid payment method.");
        }

        // ===============================================
        // 2. Parallel Fetch: User Profile & Cart
        // ===============================================
        const userProfile = await strapi.db
          .query("api::user-profile.user-profile")
          .findOne({
            where: { users_permissions_user: user.id },
            select: ["id", "documentId", "email", "fullName", "phoneNumber"],
          });

        if (!userProfile) {
          return ctx.badRequest("User profile not found.");
        }

        const cart: any = await strapi.documents("api::cart.cart").findFirst({
          filters: {
            user_profile: {
              documentId: userProfile.documentId,
            },
          },
          populate: {
            pickup_address: { fields: ["id", "documentId", "fullAddress"] },
            delivery_address: { fields: ["id", "documentId", "fullAddress"] },
            cart_items: {
              populate: {
                service: {
                  fields: ["id", "documentId", "name", "scheduleType"],
                },
                service_varient: { fields: ["id", "documentId", "name"] },
                service_pricing: { fields: ["id", "documentId"] },
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

        // ===============================================
        // 3. Helper: Generate Order Number Fast
        // ===============================================
        const generateOrderNo = () => {
          const year = new Date().getFullYear().toString().slice(-2);
          const randomCode = crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase();
          return `ORD${year}-${randomCode}`;
        };

        // ===============================================
        // 4. Validate Schedule Type
        // ===============================================
        const orderScheduleType = cart.cart_items[0]?.service?.scheduleType;

        if (orderScheduleType === "pickup_delivery") {
          if (!cart.pickup_address)
            throw new Error("Pickup address is missing.");
          if (!cart.delivery_address)
            throw new Error("Delivery address is missing.");
          if (!cart.pickupDate) throw new Error("Pickup date is missing.");
          if (!cart.pickupTime) throw new Error("Pickup time is missing.");
          if (!cart.deliveryDate) throw new Error("Delivery date is missing.");
          if (!cart.deliveryTime) throw new Error("Delivery time is missing.");
        } else if (orderScheduleType === "appointment") {
          if (!cart.pickup_address)
            throw new Error("Pickup address is missing.");
          if (!cart.appointmentDate)
            throw new Error("Appointment date is missing.");
          if (!cart.appointmentTime)
            throw new Error("Appointment time is missing.");
        }

        // ===============================================
        // 5. Handle Online Payment Flow
        // ===============================================
        if (paymentMethod === "online") {
          const orderNo = generateOrderNo();

          const paymentCollection = await strapi
            .documents("api::payment-collection.payment-collection")
            .create({
              data: {
                cart: cart.documentId,
                amount: Number(cart.grandTotal),
                payment_status: "pending",
              },
            });

          try {
            const response = await axios.post(
              "https://upigateway.dev/api/create-order",
              {
                customer_mobile: userProfile.phoneNumber,
                user_token: process.env.UPI_GATEWAY_TOKEN,
                amount: Number(cart.grandTotal).toString(),
                order_id: orderNo,
                redirect_url: `${process.env.FRONTEND_URL}/payment-success`,
                remark1: orderNo,
                remark2: paymentCollection.documentId,
              },
              {
                headers: { "Content-Type": "application/json" },
              },
            );

            const result = response.data;
            if (!result.status) {
              throw new Error(result.message || "Unable to create payment.");
            }

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

            return ctx.send({
              message: "Payment initiated successfully.",
              paymentUrl: result.result.payment_url,
              paymentCollectionId: paymentCollection.documentId,
            });
          } catch (error) {
            strapi.log.error("Payment Gateway Error:", error);
            return ctx.badRequest("Unable to initialize payment.");
          }
        }

        // ===============================================
        // 6. Handle COD Flow
        // ===============================================
        if (paymentMethod === "cod") {
          const cartItems = [...(cart.cart_items || [])];
          const normalItems = cartItems.filter(
            (item: any) => item.expressDelivery !== true,
          );
          const expressItems = cartItems.filter(
            (item: any) => item.expressDelivery === true,
          );

          // Order creation helper
          const createOrderForItems = async (
            items: any[],
            isExpressOrder: boolean,
          ) => {
            if (!items.length) return null;

            const currentOrderNo = generateOrderNo();

            const orderSubTotal = Number(
              items
                .reduce(
                  (sum: number, item: any) =>
                    sum + Number(item.totalPrice || 0),
                  0,
                )
                .toFixed(2),
            );

            const orderTax = 0;
            const orderDiscount = 0;
            const orderDeliveryCharge = 0;
            const orderGrandTotal = Number(
              (
                orderSubTotal +
                orderTax +
                orderDeliveryCharge -
                orderDiscount
              ).toFixed(2),
            );

            let deliveryDate = cart.deliveryDate;
            let deliveryTime = cart.deliveryTime;

            if (isExpressOrder && orderScheduleType === "pickup_delivery") {
              const pickupDateTime = new Date(
                `${cart.pickupDate}T${cart.pickupTime}`,
              );
              if (isNaN(pickupDateTime.getTime())) {
                throw new Error("Invalid pickup date or time.");
              }

              pickupDateTime.setTime(
                pickupDateTime.getTime() + 24 * 60 * 60 * 1000,
              );

              const yearVal = pickupDateTime.getFullYear();
              const monthVal = String(pickupDateTime.getMonth() + 1).padStart(
                2,
                "0",
              );
              const dayVal = String(pickupDateTime.getDate()).padStart(2, "0");
              const hoursVal = String(pickupDateTime.getHours()).padStart(
                2,
                "0",
              );
              const minutesVal = String(pickupDateTime.getMinutes()).padStart(
                2,
                "0",
              );

              deliveryDate = `${yearVal}-${monthVal}-${dayVal}`;
              deliveryTime = `${hoursVal}:${minutesVal}:00.000`;
            }

            // 1. Create Parent Order
            const createdOrder = await strapi
              .documents("api::order.order")
              .create({
                data: {
                  orderNo: currentOrderNo,
                  ...(orderScheduleType === "pickup_delivery" && {
                    pickupDate: cart.pickupDate,
                    pickupTime: cart.pickupTime,
                    deliveryDate,
                    deliveryTime,
                    delivery_address: cart.delivery_address?.documentId ?? null,
                  }),
                  ...(orderScheduleType === "appointment" && {
                    appointmentDate: cart.appointmentDate,
                    appointmentTime: cart.appointmentTime,
                  }),
                  paymentMethod,
                  paymentStatus: "pending",
                  orderStatus: "pending",
                  subTotal: orderSubTotal,
                  tax: orderTax,
                  discount: orderDiscount,
                  deliveryCharge: orderDeliveryCharge,
                  grandTotal: orderGrandTotal,
                  specialInstruction: cart.specialInstructions,
                  pickup_address: cart.pickup_address?.documentId ?? null,
                  user_profile: userProfile.documentId,
                },
              });

            // Fetch numeric DB ID for relational inserts
            const createdDbOrder = await strapi.db
              .query("api::order.order")
              .findOne({
                where: { documentId: createdOrder.documentId },
                select: ["id"],
              });
            const orderId = createdDbOrder.id;

            // 2. Fast Entity Service Batch Operations
            await Promise.all([
              ...items.map((item: any) =>
                strapi.entityService.create("api::order-item.order-item", {
                  data: {
                    order: orderId,
                    service: item.service?.id,
                    service_varient: item.service_varient?.id || null,
                    service_pricing: item.service_pricing?.id,
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
              strapi.entityService.create(
                "api::order-status-history.order-status-history",
                {
                  data: {
                    order: orderId,
                    statusUpdatedTo: "pending",
                    updatedByType: "system",
                  },
                },
              ),
              strapi.entityService.create(
                "api::payment-collection.payment-collection",
                {
                  data: {
                    order: orderId,
                    amount: orderGrandTotal,
                    payment_status: "pending",
                  },
                },
              ),
            ]);

            return {
              order: createdOrder,
              orderNo: currentOrderNo,
              items,
              grandTotal: orderGrandTotal,
            };
          };

          // Run normal and express creations concurrently if both exist
          const [normalOrder, expressOrder] = await Promise.all([
            createOrderForItems(normalItems, false),
            createOrderForItems(expressItems, true),
          ]);

          const createdOrders = [normalOrder, expressOrder].filter(Boolean);

          // ===============================================
          // 7. Non-Critical Background Tasks
          // ===============================================
          const cartDocumentId = cart.documentId;
          const { email, fullName } = userProfile;

          setImmediate(async () => {
            // 1. Bulk Clear Cart in 2 queries
            try {
              const cartDb = await strapi.db.query("api::cart.cart").findOne({
                where: { documentId: cartDocumentId },
                select: ["id"],
              });

              if (cartDb) {
                await strapi.db.query("api::cart-item.cart-item").deleteMany({
                  where: {
                    cart: cartDb.id,
                  },
                });
                await strapi.documents("api::cart.cart").delete({
                  documentId: cartDocumentId,
                });
              }
            } catch (error) {
              strapi.log.error("Cart cleanup failed:", error);
            }

            // 2. Emails, Notifications, and Sockets
            for (const created of createdOrders as any[]) {
              try {
                const emailItems = created.items.map((item: any) => ({
                  serviceName: item.service?.name,
                  variantName: item.service_varient?.name,
                  quantity: item.quantity,
                  totalPrice: item.totalPrice,
                }));

                sendOrderConfirmationEmail(
                  email,
                  fullName,
                  created.orderNo,
                  created.grandTotal,
                  paymentMethod,
                  emailItems,
                ).catch((err) =>
                  strapi.log.error(
                    `Order ${created.orderNo} Email failed:`,
                    err,
                  ),
                );

                createNotification({
                  strapi,
                  title: "New Order Received",
                  description: `New order ${created.orderNo} has been received.`,
                  type: "order",
                }).catch((err) =>
                  strapi.log.error(
                    `Order ${created.orderNo} Notification failed:`,
                    err,
                  ),
                );

                const io = getIO();
                if (io) {
                  io.to("admin-orders").emit("order-created", {
                    order: created.order,
                    orderNo: created.orderNo,
                    grandTotal: created.grandTotal,
                  });
                }
              } catch (error) {
                strapi.log.error(
                  `Background task failed for ${created.orderNo}:`,
                  error,
                );
              }
            }
          });

          // ===============================================
          // 8. Immediate API Response
          // ===============================================
          return ctx.send({
            message: "Order created successfully.",
            orders: createdOrders.map((created: any) => ({
              documentId: created.order.documentId,
              orderNo: created.orderNo,
              grandTotal: created.grandTotal,
              express: created.items.some(
                (item: any) => item.expressDelivery === true,
              ),
            })),
          });
        }
      } catch (error: any) {
        strapi.log.error("Create Order Error:", error);
        return ctx.badRequest(error?.message || "Failed to create order.");
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
            return ctx.badRequest("User profile not found.");
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
              "Invalid orderType. Use all, active, or delivered.",
            );
          }
        }

        // ===============================================
        // Admin / SuperAdmin -> All Orders
        // ===============================================
        else if (roleName !== "Admin" && roleName !== "SuperAdmin") {
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
          const customerOrders = orders.map((order: any) => ({
            documentId: order.documentId,
            orderNo: order.orderNo,
            createdAt: order.createdAt,
            grandTotal: order.grandTotal,
            orderStatus: order.orderStatus,
            deliveredAt: order.deliveredAt,
            expressDelivery: (order.order_items || []).every(
              (item: any) => item.expressDelivery === true,
            ),
            orderItems: (order.order_items || []).map((item: any) => ({
              quantity: item.quantity,
              serviceName: item.service?.name || null,
              serviceVarientName: item.service_varient?.name || null,
            })),
          }));

          return ctx.send({
            data: customerOrders,
          });
        }

        // ===============================================
        // ADMIN / SUPERADMIN RESPONSE
        // ===============================================

        if (roleName === "Admin" || roleName === "SuperAdmin") {
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
            const userProfileId = order.user_profile?.documentId;

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

            const paidAmount = (order.payment_collections || [])
              .filter((payment: any) => payment.payment_status === "paid")
              .reduce(
                (total: number, payment: any) =>
                  total + Number(payment.amount || 0),
                0,
              );

            customerStats[userProfileId].totalSpend += paidAmount;
          }

          // ===========================================
          // Admin Orders
          // ===========================================

          const adminOrders = orders.map((order: any) => {
            const userProfileId = order.user_profile?.documentId;

            const stats = userProfileId
              ? customerStats[userProfileId]
              : {
                  totalOrders: 0,
                  totalSpend: 0,
                };

            return {
              documentId: order.documentId,
              orderNo: order.orderNo,
              orderStatus: order.orderStatus,
              createdAt: order.createdAt,
              expressDelivery: (order.order_items || []).every(
                (item: any) => item.expressDelivery === true,
              ),
              paymentStatus: order.paymentStatus,
              specialInstruction: order.specialInstruction,
              pickupDate: order.pickupDate,
              pickupTime: order.pickupTime,
              deliveryDate: order.deliveryDate,
              deliveryTime: order.deliveryTime,
              deliveryAt: order.deliveredAt || null,
              grandTotal: order.grandTotal,
              pickupAddress: {
                fullAddress: order.pickup_address?.fullAddress || null,
              },
              deliveryAddress: {
                fullAddress: order.delivery_address?.fullAddress || null,
              },
              user: {
                fullName: order.user_profile?.fullName || null,
                email: order.user_profile?.email || null,
                phone: order.user_profile?.phoneNumber || null,
                totalOrders: stats.totalOrders,
                totalSpend: stats.totalSpend,
              },
              orderItems: (order.order_items || []).map((item: any) => ({
                quantity: item.quantity,
                serviceName: item.service?.name || null,
                serviceVarientName: item.service_varient?.name || null,
                price: item.service_pricing?.price ?? null,
                offerPrice: item.service_pricing?.offerPrice ?? null,
              })),
              deliveryPerson: {
                documentId: order.delivery_driver?.documentId || null,
                fullName: order.delivery_driver?.fullName || null,
                phoneNumber: order.delivery_driver?.phoneNumber || null,
              },
              pickupPerson: {
                documentId: order.pickup_driver?.documentId || null,
                fullName: order.pickup_driver?.fullName || null,
                phoneNumber: order.ppickup_driver?.phoneNumber || null,
              },
            };
          });

          return ctx.send({
            data: adminOrders,
          });
        }
      } catch (error: any) {
        strapi.log.error("Find Orders Error:", error);

        return ctx.badRequest(error?.message || "Unable to fetch orders.");
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
            delivery_driver: true,
            pickup_driver: true,
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

          if (order.user_profile?.documentId !== userProfile.documentId) {
            return ctx.forbidden("You are not allowed to access this order.");
          }
        }
        // ===============================================
        // Admin / SuperAdmin -> Can View Any Order
        // ===============================================
        else if (roleName !== "Admin" && roleName !== "SuperAdmin") {
          return ctx.forbidden("You are not allowed to access this order.");
        }

        // ===============================================
        // Customer -> Return simplified order response
        // ===============================================

        if (roleName === "Customer") {
          const customerOrder = {
            id: order.id,
            documentId: order.documentId,
            orderNo: order.orderNo,
            pickupDate: order.pickupDate,
            pickupTime: order.pickupTime,
            deliveryDate: order.deliveryDate,
            deliveryTime: order.deliveryTime,
            deliveredAt: order.deliveredAt,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            orderStatus: order.orderStatus,
            grandTotal: order.grandTotal,
            specialInstruction: order.specialInstruction,
            expressDelivery: (order.order_items || []).every(
              (item: any) => item.expressDelivery === true,
            ),
            pickup_address: order.pickup_address
              ? {
                  fullAddress: order.pickup_address.fullAddress,
                }
              : null,

            delivery_address: order.delivery_address
              ? {
                  fullAddress: order.delivery_address.fullAddress,
                }
              : null,

            delivery_driver: order.delivery_driver
              ? {
                  fullName: order.delivery_driver.fullName,
                  phoneNumber: order.delivery_driver.phoneNumber,
                }
              : null,

            pickup_driver: order.pickup_driver
              ? {
                  fullName: order.pickup_driver.fullName,
                  phoneNumber: order.pickup_driver.phoneNumber,
                }
              : null,

            order_items: order.order_items?.map((item) => ({
              id: item.id,
              documentId: item.documentId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              offerPrice: item.offerPrice,
              expressDelivery: item.expressDelivery,
              expressDeliveryPrice: item.expressDeliveryPrice,
              totalPrice: item.totalPrice,
              remarks: item.remarks,

              service: item.service
                ? {
                    name: item.service.name,
                  }
                : null,

              service_varient: item.service_varient
                ? {
                    name: item.service_varient.name,
                    image: item.service_varient.image
                      ? item.service_varient.image.url
                      : null,
                  }
                : null,
            })),
          };

          return ctx.send({
            data: customerOrder,
          });
        }

        // ===============================================
        // Admin / SuperAdmin -> Existing full response
        // ===============================================

        return ctx.send({
          data: {
            ...order,

            expressDelivery: (order.order_items || []).every(
              (item: any) => item.expressDelivery === true,
            ),
          },
        });
      } catch (error: any) {
        strapi.log.error("Find Order Error:", error);

        return ctx.badRequest(error?.message || "Unable to fetch order.");
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

        if (roleName !== "Admin" && roleName !== "SuperAdmin") {
          return ctx.forbidden("Only Admin and SuperAdmin can update orders.");
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

        const updatedOrder = await strapi.documents("api::order.order").update({
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

        return ctx.badRequest(error?.message || "Unable to update order.");
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

        if (roleName !== "Admin" && roleName !== "SuperAdmin") {
          return ctx.forbidden("Only Admin and SuperAdmin can delete orders.");
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

        return ctx.badRequest(error?.message || "Unable to delete order.");
      }
    },

    async cancel(ctx) {
      try {
        const user = ctx.state.user;

        // ============================================
        // 1. Check logged-in user
        // ============================================

        if (!user) {
          return ctx.unauthorized("You must be logged in.");
        }

        const { documentId } = ctx.params;
        const { cancellationReason } = ctx.request.body;

        // ============================================
        // 2. Validate cancellation reason
        // ============================================

        if (!cancellationReason || !cancellationReason.trim()) {
          return ctx.badRequest("Cancellation reason is required.");
        }

        // ============================================
        // 3. Find order + user profile
        // ============================================

        const order = await strapi.documents("api::order.order").findOne({
          documentId,
          populate: {
            user_profile: {
              populate: {
                users_permissions_user: true,
              },
            },
          },
        });

        if (!order) {
          return ctx.notFound("Order not found.");
        }

        // ============================================
        // 4. Verify customer owns the order
        // ============================================

        const orderUserId = order.user_profile?.users_permissions_user?.id;

        if (!orderUserId || orderUserId !== user.id) {
          return ctx.forbidden("You are not authorized to cancel this order.");
        }

        // ============================================
        // 5. Check order cancellation status
        // ============================================

        if (order.orderStatus === "cancelled") {
          return ctx.badRequest("Order is already cancelled.");
        }

        if (order.orderStatus !== "pending") {
          return ctx.badRequest(
            "Order can only be cancelled when its status is pending.",
          );
        }

        // ============================================
        // 6. Update order
        // ============================================

        const updatedOrder = await strapi.documents("api::order.order").update({
          documentId,
          data: {
            orderStatus: "cancelled",
            paymentStatus: "cancelled",
            cancellationReason: cancellationReason.trim(),
          },
          populate: {
            payment_collections: true,
          },
        });

        // ============================================
        // 7. Update Payment Collection
        // ============================================

        const paymentCollections = (updatedOrder as any).payment_collections;

        if (paymentCollections?.length) {
          for (const payment of paymentCollections) {
            await strapi
              .documents("api::payment-collection.payment-collection")
              .update({
                documentId: payment.documentId,
                data: {
                  payment_status: "cancelled",
                },
              });
          }
        }

        // ============================================
        // 8. Create order status history
        // ============================================

        const statusResult = await strapi
          .documents("api::order-status-history.order-status-history" as any)
          .create({
            data: {
              statusUpdatedTo: "cancelled",
              updatedByType: "customer",
              cancellationReason: cancellationReason.trim(),

              order: {
                connect: [
                  {
                    documentId: documentId,
                  },
                ],
              },

              status_updated_by: {
                connect: [
                  {
                    documentId: user.documentId,
                  },
                ],
              },
            },
          });

        // ============================================
        // Emit Updated Order To Customer
        // ============================================

        const io = getIO();

        io.to(`order-${documentId}`).emit("order-updated", {
          order: updatedOrder,
          status: statusResult,
        });

        io.to("admin-orders").emit("order-updated", {
          order: updatedOrder,
          status: statusResult,
        });

        // ============================================
        // 9. Return response
        // ============================================

        return ctx.send({
          message: "Order cancelled successfully.",
          documentId: updatedOrder?.documentId,
          orderNo: updatedOrder?.orderNo,
        });
      } catch (error) {
        console.error("Cancel order error:", error);

        return ctx.internalServerError(
          "Something went wrong while cancelling the order.",
        );
      }
    },
  }),
);
