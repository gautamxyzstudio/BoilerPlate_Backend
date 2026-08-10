// import type { Context } from "koa"
// import { emitOrderStatusUpdated } from "../../../utils/socket";

// export default {
//     async updateStatus(ctx: Context) {
//         try {
//             // ===============================================
//             // Logged-in User
//             // ===============================================

//             const user = ctx.state.user;

//             if (!user) {
//                 return ctx.unauthorized("You must be logged in.");
//             }

//             // ===============================================
//             // Validate User Role
//             // ===============================================
//             const loggedInUser = await strapi.documents(
//                 "plugin::users-permissions.user"
//             ).findOne({
//                 documentId: user.documentId,
//                 populate: {
//                     role: true,
//                 },
//             });

//             if (!loggedInUser) {
//                 return ctx.unauthorized("Logged-in user not found.");
//             }

//             const userRole = (loggedInUser as any)?.role?.name as string;

//             const allowedRoles = [
//                 "Admin",
//                 "SubAdmin",
//                 "Staff",
//                 "Driver",
//             ];

//             if (!allowedRoles.includes(userRole)) {
//                 return ctx.forbidden(
//                     "You are not authorized to update order status."
//                 );
//             }

//             // ===============================================
//             // Determine Updated By Type
//             // ===============================================

//             let updatedByType: "admin" | "staff";

//             switch (userRole) {
//                 case "Admin":
//                 case "SubAdmin":
//                     updatedByType = "admin";
//                     break;

//                 case "Staff":
//                 case "Driver":
//                     updatedByType = "staff";
//                     break;

//                 default:
//                     return ctx.forbidden(
//                         "You are not authorized to update order status."
//                     );
//             }

//             // ===============================================
//             // Params & Body
//             // ===============================================

//             const { documentId } = ctx.params;

//             const body = ctx.request.body?.data || ctx.request.body || {};

//             const { orderStatus } = body;

//             if (!orderStatus) {
//                 return ctx.badRequest("Order status is required.");
//             }

//             // ===============================================
//             // Fetch Order
//             // ===============================================

//             const order = await strapi.documents("api::order.order" as any).findOne({
//                 documentId,
//                 populate: {
//                     user_profile: true,
//                     order_items: {
//                         populate: {
//                             service: {
//                                 fields: ["scheduleType"],
//                             },
//                         },
//                     },
//                 },
//             });

//             if (!order) {
//                 return ctx.notFound("Order not found.");
//             }

//             // ===============================================
//             // Prevent Updating Closed Orders
//             // ===============================================

//             if (
//                 ["completed", "cancelled", "refunded"].includes(
//                     order.orderStatus
//                 )
//             ) {
//                 return ctx.badRequest(
//                     `Order is already ${order.orderStatus}.`
//                 );
//             }

//             // ===============================================
//             // Determine Schedule Type
//             // ===============================================

//             const scheduleType =
//                 (order.order_items?.[0] as any)?.service?.scheduleType;

//             if (!scheduleType) {
//                 return ctx.badRequest("Unable to determine schedule type.");
//             }

//             // ===============================================
//             // Validate Status Based on Schedule Type
//             // ===============================================

//             const pickupDeliveryStatuses = [
//                 "pending",
//                 "pickup_assigned",
//                 "picked_up",
//                 "processing",
//                 "out_for_delivery",
//                 "delivered",
//                 "cancelled",
//                 "refunded",
//             ];

//             const appointmentStatuses = [
//                 "pending",
//                 "professional_assigned",
//                 "professional_on_the_way",
//                 "arrived",
//                 "service_started",
//                 "completed",
//                 "cancelled",
//                 "refunded",
//             ];

//             if (
//                 scheduleType === "pickup_delivery" &&
//                 !pickupDeliveryStatuses.includes(orderStatus)
//             ) {
//                 return ctx.badRequest(
//                     `Invalid status '${orderStatus}' for pickup & delivery service.`
//                 );
//             }

//             if (
//                 scheduleType === "appointment" &&
//                 !appointmentStatuses.includes(orderStatus)
//             ) {
//                 return ctx.badRequest(
//                     `Invalid status '${orderStatus}' for appointment service.`
//                 );
//             }

//             // ===============================================
//             // Determine Generic Order Status
//             // ===============================================

//             let genericOrderStatus:
//                 | "pending"
//                 | "in_progress"
//                 | "completed"
//                 | "cancelled"
//                 | "refunded";

//             switch (orderStatus) {
//                 case "pending":
//                     genericOrderStatus = "pending";
//                     break;

//                 case "delivered":
//                 case "completed":
//                     genericOrderStatus = "completed";
//                     break;

//                 case "cancelled":
//                     genericOrderStatus = "cancelled";
//                     break;

//                 case "refunded":
//                     genericOrderStatus = "refunded";
//                     break;

//                 default:
//                     genericOrderStatus = "in_progress";
//                     break;
//             }

//             // ===============================================
//             // Check Latest Order Status
//             // ===============================================

//             const latestHistory = await strapi
//                 .documents("api::order-status-history.order-status-history" as any)
//                 .findFirst({
//                     filters: {
//                         order: {
//                             documentId: order.documentId,
//                         },
//                     },
//                     sort: ["createdAt:desc"],
//                     fields: ["orderStatus"],
//                 });

//             if (latestHistory?.orderStatus === orderStatus) {
//                 return ctx.badRequest(
//                     `Order is already in '${orderStatus}' status.`
//                 );
//             }

//             const statusFlow =
//                 scheduleType === "pickup_delivery"
//                     ? pickupDeliveryStatuses
//                     : appointmentStatuses;

//             const currentIndex = latestHistory
//                 ? statusFlow.indexOf(latestHistory.orderStatus)
//                 : -1;

//             const nextIndex = statusFlow.indexOf(orderStatus);

//             if (nextIndex < currentIndex) {
//                 return ctx.badRequest(
//                     "Cannot move order back to a previous status."
//                 );
//             }

//             // ===============================================
//             // Create Order Status History
//             // ===============================================

//             await strapi
//                 .documents("api::order-status-history.order-status-history")
//                 .create({
//                     data: {
//                         order: order.documentId,
//                         orderStatus,
//                         status_updated_by: loggedInUser?.documentId,
//                         updatedByType,
//                     },
//                 });

//             // ===============================================
//             // Prepare Order Update Data
//             // ===============================================

//             const updateData: any = {
//                 orderStatus: genericOrderStatus,
//             };

//             if (scheduleType === "appointment") {

//                 if (orderStatus === "service_started") {
//                     updateData.startedAt = new Date();
//                 }

//                 if (orderStatus === "completed") {
//                     updateData.completedAt = new Date();
//                 }

//             }

//             if (scheduleType === "pickup_delivery") {

//                 if (orderStatus === "picked_up") {
//                     updateData.pickedUpAt = new Date();
//                 }

//                 if (orderStatus === "processing") {
//                     updateData.processingStartedAt = new Date();
//                 }

//                 if (orderStatus === "delivered") {
//                     updateData.deliveredAt = new Date();
//                 }

//             }

//             const updatedOrder = await strapi
//                 .documents("api::order.order")
//                 .update({
//                     documentId: order.documentId,
//                     data: updateData,
//                 });

//             // ===============================================
//             // Emit Socket Event
//             // ===============================================

//             emitOrderStatusUpdated({
//                 orderDocumentId: order.documentId,
//                 orderStatus,
//                 updatedAt: new Date().toISOString(),
//             });
//             // ===============================================
//             // Return Response
//             // ===============================================

//             const response = await strapi.documents("api::order.order").findOne({
//                 documentId: order.documentId,
//                 populate: {
//                     order_status_histories: {
//                         sort: ["createdAt:asc"],
//                     },
//                 },
//             });

//             return ctx.send({
//                 message: "Order status updated successfully.",
//                 data: response,
//             });

//         } catch (error: any) {

//             strapi.log.error("Update Order Status Error:", error);

//             return ctx.badRequest(
//                 error?.message || "Failed to update order status."
//             );
//         }
//     }
// }

import type { Context } from "koa";
import { emitOrderStatusUpdated } from "../../../utils/socket";

export default {
    async updateStatus(ctx: Context) {
        try {
            // ===============================================
            // Logged-in User
            // ===============================================

            const user = ctx.state.user;

            if (!user) {
                return ctx.unauthorized("You must be logged in.");
            }

            // ===============================================
            // Validate User Role
            // ===============================================

            const loggedInUser = await strapi
                .documents("plugin::users-permissions.user")
                .findOne({
                    documentId: user.documentId,
                    populate: {
                        role: true,
                    },
                });

            if (!loggedInUser) {
                return ctx.unauthorized("Logged-in user not found.");
            }

            const userRole = (loggedInUser as any)?.role?.name as
                | string
                | undefined;

            const allowedRoles = [
                "Admin",
                "SubAdmin",
                "Staff",
                "Driver",
            ];

            if (!userRole || !allowedRoles.includes(userRole)) {
                return ctx.forbidden(
                    "You are not authorized to update order status."
                );
            }

            // ===============================================
            // Determine Updated By Type
            // ===============================================

            let updatedByType: "admin" | "staff";

            switch (userRole) {
                case "Admin":
                case "SubAdmin":
                    updatedByType = "admin";
                    break;

                case "Staff":
                case "Driver":
                    updatedByType = "staff";
                    break;

                default:
                    return ctx.forbidden(
                        "You are not authorized to update order status."
                    );
            }

            // ===============================================
            // Params & Body
            // ===============================================

            const { documentId } = ctx.params;

            const body =
                ctx.request.body?.data ||
                ctx.request.body ||
                {};

            const { orderStatus } = body;

            if (!orderStatus) {
                return ctx.badRequest(
                    "Order status is required."
                );
            }

            // ===============================================
            // Fetch Order
            // ===============================================

            const order = await strapi
                .documents("api::order.order" as any)
                .findOne({
                    documentId,
                    populate: {
                        user_profile: true,
                        order_items: {
                            populate: {
                                service: {
                                    fields: ["scheduleType"],
                                },
                            },
                        },
                    },
                });

            if (!order) {
                return ctx.notFound("Order not found.");
            }

            // ===============================================
            // Prevent Updating Closed Orders
            // ===============================================

            if (
                [
                    "completed",
                    "cancelled",
                    "refunded",
                ].includes(order.orderStatus)
            ) {
                return ctx.badRequest(
                    `Order is already ${order.orderStatus}.`
                );
            }

            // ===============================================
            // Determine Schedule Type
            // ===============================================

            const scheduleType =
                (order.order_items?.[0] as any)
                    ?.service?.scheduleType;

            if (!scheduleType) {
                return ctx.badRequest(
                    "Unable to determine schedule type."
                );
            }

            if (
                scheduleType !== "pickup_delivery" &&
                scheduleType !== "appointment"
            ) {
                return ctx.badRequest(
                    "Invalid order schedule type."
                );
            }

            // ===============================================
            // Validate Status Based on Schedule Type
            // ===============================================

            const pickupDeliveryStatuses = [
                "pending",
                "pickup_assigned",
                "picked_up",
                "processing",
                "out_for_delivery",
                "delivered",
                "cancelled",
                "refunded",
            ];

            const appointmentStatuses = [
                "pending",
                "professional_assigned",
                "professional_on_the_way",
                "arrived",
                "service_started",
                "completed",
                "cancelled",
                "refunded",
            ];

            const statusFlow =
                scheduleType === "pickup_delivery"
                    ? pickupDeliveryStatuses
                    : appointmentStatuses;

            if (!statusFlow.includes(orderStatus)) {
                return ctx.badRequest(
                    `Invalid status '${orderStatus}' for ${scheduleType} service.`
                );
            }

            // ===============================================
            // Get Latest Status History
            // ===============================================

            const latestHistory = await strapi
                .documents(
                    "api::order-status-history.order-status-history" as any
                )
                .findFirst({
                    filters: {
                        order: {
                            documentId: order.documentId,
                        },
                    },
                    sort: ["createdAt:desc"],
                    fields: ["statusUpdatedTo"],
                });

            // ===============================================
            // Prevent Duplicate Status
            // ===============================================

            if (
                latestHistory?.statusUpdatedTo ===
                orderStatus
            ) {
                return ctx.badRequest(
                    `Order is already in '${orderStatus}' status.`
                );
            }

            // ===============================================
            // Prevent Backward Status
            // ===============================================

            const currentIndex = latestHistory
                ? statusFlow.indexOf(
                    latestHistory.statusUpdatedTo
                )
                : -1;

            const nextIndex =
                statusFlow.indexOf(orderStatus);

            if (
                currentIndex !== -1 &&
                nextIndex < currentIndex
            ) {
                return ctx.badRequest(
                    "Cannot move order back to a previous status."
                );
            }

            // ===============================================
            // Create Order Status History
            // ===============================================

            await strapi
                .documents(
                    "api::order-status-history.order-status-history"
                )
                .create({
                    data: {
                        order: order.documentId,
                        statusUpdatedTo: orderStatus,
                        status_updated_by:
                            loggedInUser.documentId,
                        updatedByType,
                    },
                });

            // ===============================================
            // Prepare Order Update
            // ===============================================

            const updateData: any = {
                orderStatus,
            };

            // ===============================================
            // Appointment Timestamps
            // ===============================================

            if (scheduleType === "appointment") {

                if (
                    orderStatus ===
                    "service_started"
                ) {
                    updateData.startedAt =
                        new Date();
                }

                if (
                    orderStatus ===
                    "completed"
                ) {
                    updateData.completedAt =
                        new Date();
                }
            }

            // ===============================================
            // Pickup & Delivery Timestamps
            // ===============================================

            if (
                scheduleType ===
                "pickup_delivery"
            ) {

                if (
                    orderStatus ===
                    "picked_up"
                ) {
                    updateData.pickedUpAt =
                        new Date();
                }

                if (
                    orderStatus ===
                    "processing"
                ) {
                    updateData.processingStartedAt =
                        new Date();
                }

                if (
                    orderStatus ===
                    "delivered"
                ) {
                    updateData.deliveredAt =
                        new Date();
                }
            }

            // ===============================================
            // Update Order Current Status
            // ===============================================

            await strapi
                .documents("api::order.order")
                .update({
                    documentId:
                        order.documentId,
                    data: updateData,
                });

            // ===============================================
            // Emit Socket Event
            // ===============================================

            const updatedAt = new Date().toISOString();

            emitOrderStatusUpdated({
                orderDocumentId: order.documentId,
                orderStatus,
                updatedAt,
            });

            // ===============================================
            // Response
            // ===============================================

            return ctx.send({
                message: "Order status updated successfully.",
                data: {
                    orderDocumentId: order.documentId,
                    orderNo: order.orderNo,
                    statusUpdatedTo: orderStatus,
                    status_updated_by: loggedInUser.documentId,
                    updatedByType,
                    updatedAt,
                },
            });

        } catch (error: any) {

            strapi.log.error(
                "Update Order Status Error:",
                error
            );

            return ctx.badRequest(
                error?.message ||
                "Failed to update order status."
            );
        }
    },
};