/**
 * order-status-history service
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreService(
    "api::order-status-history.order-status-history",
    ({ strapi }) => ({

        async updateOrderStatus(
            orderDocumentId: string,
            orderStatus: string,
            loggedInUser: any
        ) {
            // ===============================================
            // Validate User
            // ===============================================

            if (!loggedInUser) {
                throw new Error("You must be logged in.");
            }

            // ===============================================
            // User Role
            // ===============================================

            const userRole =
                loggedInUser.role?.name;

            const allowedRoles = [
                "Admin",
                "superAdmin",
                "Staff",
                "Driver",
            ];

            if (!allowedRoles.includes(userRole)) {
                throw new Error(
                    "You are not authorized to update order status."
                );
            }

            // ===============================================
            // Determine Updated By Type
            // ===============================================

            let updatedByType: "admin" | "staff";

            if (
                userRole === "Admin" ||
                userRole === "superAdmin"
            ) {
                updatedByType = "admin";
            } else {
                updatedByType = "staff";
            }

            // ===============================================
            // Fetch Order
            // ===============================================

            const order = await strapi
                .documents("api::order.order" as any)
                .findOne({
                    documentId: orderDocumentId,
                    populate: {
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
                throw new Error("Order not found.");
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
                throw new Error(
                    `Order is already ${order.orderStatus}.`
                );
            }

            // ===============================================
            // Schedule Type
            // ===============================================

            const scheduleType =
                (order.order_items?.[0] as any)
                    ?.service?.scheduleType;

            if (!scheduleType) {
                throw new Error(
                    "Unable to determine schedule type."
                );
            }

            // ===============================================
            // Allowed Statuses
            // ===============================================

            const pickupDeliveryStatuses = [
                "pending",
                "pickup_assigned",
                "picked_up",
                "processing",
                "delivery_assigned",
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
                throw new Error(
                    `Invalid status '${orderStatus}' for ${scheduleType} service.`
                );
            }

            // ===============================================
            // Latest History
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
            // Duplicate Status
            // ===============================================

            if (
                latestHistory?.statusUpdatedTo ===
                orderStatus
            ) {
                throw new Error(
                    `Order is already in '${orderStatus}' status.`
                );
            }

            // ===============================================
            // Prevent Backward Status
            // ===============================================

            const currentIndex =
                statusFlow.indexOf(order.orderStatus);

            const nextIndex =
                statusFlow.indexOf(orderStatus);

            if (
                currentIndex !== -1 &&
                nextIndex < currentIndex
            ) {
                throw new Error(
                    "Cannot move order back to a previous status."
                );
            }

            // ===============================================
            // Create Status History
            // ===============================================

            await strapi
                .documents(
                    "api::order-status-history.order-status-history" as any
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
                    orderStatus === "service_started"
                ) {
                    updateData.startedAt =
                        new Date();
                }

                if (
                    orderStatus === "completed"
                ) {
                    updateData.completedAt =
                        new Date();
                }
            }

            // ===============================================
            // Pickup / Delivery Timestamps
            // ===============================================

            if (
                scheduleType === "pickup_delivery"
            ) {

                if (
                    orderStatus === "picked_up"
                ) {
                    updateData.pickedUpAt =
                        new Date();
                }

                if (
                    orderStatus === "processing"
                ) {
                    updateData.processingStartedAt =
                        new Date();
                }

                if (
                    orderStatus === "delivered"
                ) {
                    updateData.deliveredAt =
                        new Date();
                }
            }

            // ===============================================
            // Update Order
            // ===============================================

            await strapi
                .documents("api::order.order")
                .update({
                    documentId: order.documentId,
                    data: updateData,
                });

            // ===============================================
            // Response Data
            // ===============================================

             const updatedAt = new Date().toISOString();

            return {
                orderDocumentId: order.documentId,

                orderNo: order.orderNo,

                statusUpdatedTo: orderStatus,

                status_updated_by:
                    loggedInUser.documentId,

                updatedByType,

                updatedAt,
            };
        },
    })
);