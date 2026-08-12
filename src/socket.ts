import { Server } from "socket.io";

let io: Server;

export const initSocket = (
    httpServer: any,
    strapi: any
) => {

    io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST", "PUT", "DELETE"],
        },
    });

    io.on("connection", async (socket) => {

        console.log(
            "Socket Connected:",
            socket.id
        );

        // ===============================================
        // Socket Authentication
        // ===============================================

        try {

            const token =
                socket.handshake.auth?.token;

            if (!token) {

                socket.emit("socket-error", {
                    message:
                        "Authentication token is required.",
                });

                socket.disconnect();

                return;
            }

            // Remove Bearer prefix if provided
            const jwt = token.startsWith("Bearer ")
                ? token.substring(7)
                : token;

            // ===========================================
            // Verify Strapi JWT
            // ===========================================

            const decoded =
                await strapi
                    .plugin("users-permissions")
                    .service("jwt")
                    .verify(jwt);

            if (!decoded?.id) {

                socket.emit("socket-error", {
                    message:
                        "Invalid authentication token.",
                });

                socket.disconnect();

                return;
            }

            // ===========================================
            // Find Logged-in User
            // ===========================================

            const user = await strapi.db
                .query(
                    "plugin::users-permissions.user"
                )
                .findOne({
                    where: {
                        id: decoded.id,
                    },
                    populate: {
                        role: true,
                    },
                });

            if (!user) {

                socket.emit("socket-error", {
                    message:
                        "User not found.",
                });

                socket.disconnect();

                return;
            }

            // ===========================================
            // Store User On Socket
            // ===========================================

            socket.data.user = user;

            console.log(
                `Socket authenticated: ${user.email}`
            );

            console.log(
                `Socket user role: ${user.role?.name}`
            );

            // ===============================================
            // Normalize User Role
            // ===============================================

            const roleName = (user.role?.name || "")
                .replace(/\s+/g, "")
                .toLowerCase();

            console.log(
                `Normalized socket user role: ${roleName}`
            );

            // ===============================================
            // Join Admin Notification Room
            // ===============================================

            if (
                roleName === "admin" ||
                roleName === "superadmin"
            ) {
                socket.join("admin-notifications");
                socket.join("admin-orders");
                socket.join("admin-users");

                console.log(
                    `Socket ${socket.id} joined admin-notifications`
                );
                console.log(
                    `Socket ${socket.id} joined admin-orders`
                );
                console.log(
                    `Socket ${socket.id} joined admin-users`
                );
            }

            // ===============================================
            // Authentication Successful
            // ===============================================

            socket.emit("socket-authenticated", {
                userDocumentId: user.documentId,
                role: user.role?.name,
            });

        } catch (error) {

            console.error(
                "Socket authentication failed:",
                error
            );

            socket.emit("socket-error", {
                message:
                    "Invalid authentication token.",
            });

            socket.disconnect();

            return;
        }

        // ===============================================
        // Join Order
        // ===============================================

        socket.on(
            "join-order",
            (orderDocumentId: string) => {

                socket.join(
                    `order-${orderDocumentId}`
                );

                console.log(
                    `Socket ${socket.id} joined order-${orderDocumentId}`
                );
            }
        );

        // ===============================================
        // Leave Order
        // ===============================================

        socket.on(
            "leave-order",
            (orderDocumentId: string) => {

                socket.leave(
                    `order-${orderDocumentId}`
                );

                console.log(
                    `Socket ${socket.id} left order-${orderDocumentId}`
                );
            }
        );

        // ===============================================
        // Update Order
        // ===============================================

        socket.on(
            "update-order",
            async (data) => {

                try {

                    const {
                        orderDocumentId,
                        orderStatus,
                        pickupDriverDocumentId,
                        deliveryDriverDocumentId,
                    } = data || {};

                    // ===========================================
                    // Validate Order Document ID
                    // ===========================================

                    if (!orderDocumentId) {
                        socket.emit(
                            "order-update-error",
                            {
                                message:
                                    "Order document ID is required.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // Logged-In User
                    // ===========================================

                    const loggedInUser =
                        socket.data.user;

                    if (!loggedInUser) {
                        socket.emit(
                            "order-update-error",
                            {
                                message:
                                    "You are not authenticated.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // User Role
                    // ===========================================

                    const userRole =
                        loggedInUser.role?.name;

                    const allowedRoles = [
                        "Admin",
                        "superAdmin",
                        "Staff",
                    ];

                    if (!allowedRoles.includes(userRole)) {
                        socket.emit(
                            "order-update-error",
                            {
                                message:
                                    "You are not authorized to update orders.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // Something Must Be Updated
                    // ===========================================

                    if (
                        !orderStatus &&
                        !pickupDriverDocumentId &&
                        !deliveryDriverDocumentId
                    ) {
                        socket.emit(
                            "order-update-error",
                            {
                                message:
                                    "Please provide an order status or driver assignment.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // Pickup + Delivery Cannot Be Updated Together
                    // ===========================================

                    if (
                        pickupDriverDocumentId &&
                        deliveryDriverDocumentId
                    ) {
                        socket.emit(
                            "order-update-error",
                            {
                                message:
                                    "Pickup and delivery drivers must be assigned separately.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // Find Order
                    // ===========================================

                    const order =
                        await strapi
                            .documents("api::order.order")
                            .findOne({
                                documentId:
                                    orderDocumentId,
                            });

                    if (!order) {
                        socket.emit(
                            "order-update-error",
                            {
                                message:
                                    "Order not found.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // Determine Status
                    // ===========================================

                    let statusToUpdate =
                        orderStatus;

                    // ===========================================
                    // Pickup Driver Assignment
                    // ===========================================

                    if (pickupDriverDocumentId) {

                        // ---------------------------------------
                        // Only allowed during pickup stage
                        // ---------------------------------------

                        if (
                            order.orderStatus !==
                            "pending" &&
                            order.orderStatus !==
                            "pickup_assigned"
                        ) {

                            socket.emit(
                                "order-update-error",
                                {
                                    message:
                                        "Pickup driver can only be assigned when order status is pending or pickup_assigned.",
                                }
                            );

                            return;
                        }

                        // ---------------------------------------
                        // Validate Pickup Driver
                        // ---------------------------------------

                        const pickupDriver =
                            await strapi
                                .documents(
                                    "api::driver-detail.driver-detail"
                                )
                                .findOne({
                                    documentId:
                                        pickupDriverDocumentId,
                                });

                        if (!pickupDriver) {

                            socket.emit(
                                "order-update-error",
                                {
                                    message:
                                        "Pickup driver not found.",
                                }
                            );

                            return;
                        }

                        // ---------------------------------------
                        // If pending, assignment automatically
                        // moves order to pickup_assigned
                        // ---------------------------------------

                        if (
                            order.orderStatus ===
                            "pending"
                        ) {

                            // Do not allow a different manual
                            // status in the same request
                            if (
                                orderStatus &&
                                orderStatus !==
                                "pickup_assigned"
                            ) {
                                socket.emit(
                                    "order-update-error",
                                    {
                                        message:
                                            "When assigning a pickup driver from pending, the status can only be pickup_assigned.",
                                    }
                                );

                                return;
                            }

                            statusToUpdate =
                                "pickup_assigned";
                        }

                        // ---------------------------------------
                        // If already pickup_assigned, driver
                        // can be assigned without changing status
                        // ---------------------------------------

                        if (
                            order.orderStatus ===
                            "pickup_assigned"
                        ) {

                            if (
                                orderStatus &&
                                orderStatus !==
                                "pickup_assigned"
                            ) {
                                // Let the normal status validation
                                // handle the requested status.
                                statusToUpdate =
                                    orderStatus;
                            } else {
                                statusToUpdate =
                                    undefined;
                            }
                        }
                    }

                    // ===========================================
                    // Delivery Driver Assignment
                    // ===========================================

                    if (deliveryDriverDocumentId) {

                        // ---------------------------------------
                        // Only allowed during delivery stage
                        // ---------------------------------------

                        if (
                            order.orderStatus !==
                            "processing" &&
                            order.orderStatus !==
                            "delivery_assigned"
                        ) {

                            socket.emit(
                                "order-update-error",
                                {
                                    message:
                                        "Delivery driver can only be assigned when order status is processing or delivery_assigned.",
                                }
                            );

                            return;
                        }

                        // ---------------------------------------
                        // Validate Delivery Driver
                        // ---------------------------------------

                        const deliveryDriver =
                            await strapi
                                .documents(
                                    "api::driver-detail.driver-detail"
                                )
                                .findOne({
                                    documentId:
                                        deliveryDriverDocumentId,
                                });

                        if (!deliveryDriver) {

                            socket.emit(
                                "order-update-error",
                                {
                                    message:
                                        "Delivery driver not found.",
                                }
                            );

                            return;
                        }

                        // ---------------------------------------
                        // If processing, assignment automatically
                        // moves order to delivery_assigned
                        // ---------------------------------------

                        if (
                            order.orderStatus ===
                            "processing"
                        ) {

                            if (
                                orderStatus &&
                                orderStatus !==
                                "delivery_assigned"
                            ) {
                                socket.emit(
                                    "order-update-error",
                                    {
                                        message:
                                            "When assigning a delivery driver from processing, the status can only be delivery_assigned.",
                                    }
                                );

                                return;
                            }

                            statusToUpdate =
                                "delivery_assigned";
                        }

                        // ---------------------------------------
                        // If already delivery_assigned, driver
                        // can be assigned without changing status
                        // ---------------------------------------

                        if (
                            order.orderStatus ===
                            "delivery_assigned"
                        ) {

                            if (
                                orderStatus &&
                                orderStatus !==
                                "delivery_assigned"
                            ) {
                                statusToUpdate =
                                    orderStatus;
                            } else {
                                statusToUpdate =
                                    undefined;
                            }
                        }
                    }

                    // ===========================================
                    // Update Driver Assignment
                    // ===========================================

                    const driverUpdateData: any = {};

                    if (pickupDriverDocumentId) {
                        driverUpdateData.pickup_driver =
                            pickupDriverDocumentId;
                    }

                    if (deliveryDriverDocumentId) {
                        driverUpdateData.delivery_driver =
                            deliveryDriverDocumentId;
                    }

                    if (
                        Object.keys(driverUpdateData).length > 0
                    ) {

                        await strapi
                            .documents("api::order.order")
                            .update({
                                documentId:
                                    orderDocumentId,
                                data:
                                    driverUpdateData,
                            });
                    }

                    // ===========================================
                    // Update Status
                    // ===========================================

                    let statusResult = null;

                    if (
                        statusToUpdate &&
                        statusToUpdate !==
                        order.orderStatus
                    ) {

                        statusResult =
                            await strapi
                                .service(
                                    "api::order-status-history.order-status-history"
                                )
                                .updateOrderStatus(
                                    orderDocumentId,
                                    statusToUpdate,
                                    loggedInUser
                                );
                    }

                    // ===========================================
                    // Get Updated Order
                    // ===========================================

                    const updatedOrder =
                        await strapi
                            .documents("api::order.order")
                            .findOne({
                                documentId:
                                    orderDocumentId,
                                populate: {
                                    pickup_driver: true,
                                    delivery_driver: true,
                                    pickup_address: true,
                                    delivery_address: true,
                                    order_items: true,
                                },
                            });

                    // ===========================================
                    // Emit Updated Order
                    // ===========================================

                    io.to(
                        `order-${orderDocumentId}`
                    ).emit(
                        "order-updated",
                        {
                            order: updatedOrder,
                            status:
                                statusResult,
                        }
                    );

                    // ===========================================
                    // Success
                    // ===========================================

                    socket.emit(
                        "order-update-success",
                        {
                            order: updatedOrder,
                            status:
                                statusResult,
                        }
                    );

                } catch (error: any) {

                    console.error(
                        "Socket Order Update Error:",
                        error
                    );

                    socket.emit(
                        "order-update-error",
                        {
                            message:
                                error?.message ||
                                "Failed to update order.",
                        }
                    );
                }
            }
        );

        // ===============================================
        // Disconnect
        // ===============================================

        socket.on("disconnect", () => {

            console.log(
                "Socket Disconnected:",
                socket.id
            );

        });

    });
};

export const getIO = () => {

    if (!io) {
        throw new Error(
            "Socket.IO has not been initialized."
        );
    }

    return io;
};