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
        // Update Order Status
        // ===============================================

        socket.on(
            "update-order-status",
            async (data) => {

                try {

                    const {
                        orderDocumentId,
                        orderStatus,
                    } = data || {};

                    // ===========================================
                    // Validate Order Document ID
                    // ===========================================

                    if (!orderDocumentId) {

                        socket.emit(
                            "order-status-error",
                            {
                                message:
                                    "Order document ID is required.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // Validate Order Status
                    // ===========================================

                    if (!orderStatus) {

                        socket.emit(
                            "order-status-error",
                            {
                                message:
                                    "Order status is required.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // Get Authenticated User
                    // ===========================================

                    const loggedInUser =
                        socket.data.user;

                    if (!loggedInUser) {

                        socket.emit(
                            "order-status-error",
                            {
                                message:
                                    "You are not authenticated.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // Update Order Status
                    // ===========================================

                    const result = await strapi
                        .service(
                            "api::order-status-history.order-status-history"
                        )
                        .updateOrderStatus(
                            orderDocumentId,
                            orderStatus,
                            loggedInUser
                        );

                    // ===========================================
                    // Emit Status Update
                    // ===========================================

                    io.to(
                        `order-${orderDocumentId}`
                    ).emit(
                        "order-status-updated",
                        result
                    );

                    // ===========================================
                    // Send Success To Requesting Socket
                    // ===========================================

                    socket.emit(
                        "order-status-success",
                        result
                    );

                } catch (error: any) {

                    console.error(
                        "Socket Order Status Error:",
                        error
                    );

                    socket.emit(
                        "order-status-error",
                        {
                            message:
                                error?.message ||
                                "Failed to update order status.",
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