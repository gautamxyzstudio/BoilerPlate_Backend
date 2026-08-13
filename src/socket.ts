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
                roleName === "superadmin" ||
                roleName === "staff"
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

                    const userRole = (loggedInUser.role?.name || "")
                        .replace(/\s+/g, "")
                        .toLowerCase();

                    const allowedRoles = [
                        "admin",
                        "superadmin",
                        "staff",
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
                                documentId: orderDocumentId,
                                populate: {
                                    pickup_driver: true,
                                    delivery_driver: true,
                                    pickup_address: true,
                                    delivery_address: true,
                                    order_items: {
                                        populate: {
                                            service: true,
                                            service_varient: {
                                                populate: {
                                                    image: true,
                                                },
                                            },
                                        },
                                    },
                                },
                            });

                    if (!updatedOrder) {
                        socket.emit("order-update-error", {
                            message: "Updated order could not be found.",
                        });

                        return;
                    }

                    // ===========================================
                    // Customer Order Response
                    // ===========================================

                    const customerOrder = {
                        id: updatedOrder.id,
                        documentId: updatedOrder.documentId,
                        orderNo: updatedOrder.orderNo,
                        pickupDate: updatedOrder.pickupDate,
                        pickupTime: updatedOrder.pickupTime,
                        deliveryDate: updatedOrder.deliveryDate,
                        deliveryTime: updatedOrder.deliveryTime,
                        paymentMethod: updatedOrder.paymentMethod,
                        paymentStatus: updatedOrder.paymentStatus,
                        orderStatus: updatedOrder.orderStatus,
                        grandTotal: updatedOrder.grandTotal,
                        specialInstruction: updatedOrder.specialInstruction,
                        cancellationReason: (updatedOrder as any).cancellationReason,
                        pickup_address: updatedOrder.pickup_address
                            ? {
                                fullAddress:
                                    updatedOrder.pickup_address.fullAddress,
                            }
                            : null,

                        delivery_address: updatedOrder.delivery_address
                            ? {
                                fullAddress:
                                    updatedOrder.delivery_address.fullAddress,
                            }
                            : null,

                        delivery_driver: updatedOrder.delivery_driver
                            ? {
                                fullName:
                                    updatedOrder.delivery_driver.fullName,
                                phoneNumber:
                                    updatedOrder.delivery_driver.phoneNumber,
                            }
                            : null,

                        pickup_driver: updatedOrder.pickup_driver
                            ? {
                                fullName:
                                    updatedOrder.pickup_driver.fullName,
                                phoneNumber:
                                    updatedOrder.pickup_driver.phoneNumber,
                            }
                            : null,

                        order_items: updatedOrder.order_items?.map(
                            (item: any) => ({
                                id: item.id,
                                documentId: item.documentId,
                                quantity: item.quantity,
                                unitPrice: item.unitPrice,
                                offerPrice: item.offerPrice,
                                expressDelivery:
                                    item.expressDelivery,
                                expressDeliveryPrice:
                                    item.expressDeliveryPrice,
                                totalPrice: item.totalPrice,
                                remarks: item.remarks,

                                service: item.service
                                    ? {
                                        name:
                                            item.service.name,
                                    }
                                    : null,

                                service_varient:
                                    item.service_varient
                                        ? {
                                            name:
                                                item.service_varient.name,
                                            image:
                                                item.service_varient.image
                                                    ? item
                                                        .service_varient
                                                        .image
                                                        .url
                                                    : null,
                                        }
                                        : null,
                            })
                        ),
                    };

                    // ===========================================
                    // Emit Updated Order To Customer
                    // ===========================================

                    io.to(
                        `order-${orderDocumentId}`
                    ).emit(
                        "order-updated",
                        {
                            order: customerOrder,
                            status: statusResult,
                        }
                    );

                    // ===========================================
                    // Emit Full Order To Admin / Staff
                    // ===========================================

                    io.to("admin-orders").emit(
                        "order-updated",
                        {
                            order: updatedOrder,
                            status: statusResult,
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
        // Mark Order As Paid
        // ===============================================

        socket.on(
            "mark-order-paid",
            async (data) => {

                try {

                    const {
                        orderDocumentId,
                    } = data || {};

                    // ===========================================
                    // 1. Validate Order Document ID
                    // ===========================================

                    if (!orderDocumentId) {
                        socket.emit(
                            "mark-order-paid-error",
                            {
                                message:
                                    "Order document ID is required.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // 2. Check Logged-in User
                    // ===========================================

                    const loggedInUser =
                        socket.data.user;

                    if (!loggedInUser) {
                        socket.emit(
                            "mark-order-paid-error",
                            {
                                message:
                                    "You are not authenticated.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // 3. Check Admin / Staff Role
                    // ===========================================

                    const userRole =
                        (loggedInUser.role?.name || "")
                            .replace(/\s+/g, "")
                            .toLowerCase();

                    const allowedRoles = [
                        "admin",
                        "superadmin",
                        "staff",
                    ];

                    if (!allowedRoles.includes(userRole)) {
                        socket.emit(
                            "mark-order-paid-error",
                            {
                                message:
                                    "You are not authorized to mark orders as paid.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // 4. Find Order
                    // ===========================================

                    const order =
                        await strapi
                            .documents("api::order.order")
                            .findOne({
                                documentId:
                                    orderDocumentId,
                                populate: {
                                    payment_collections:
                                        true,
                                },
                            });

                    if (!order) {
                        socket.emit(
                            "mark-order-paid-error",
                            {
                                message:
                                    "Order not found.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // 5. Check Payment Method
                    // ===========================================

                    if (
                        order.paymentMethod !==
                        "cod"
                    ) {
                        socket.emit(
                            "mark-order-paid-error",
                            {
                                message:
                                    "Only COD orders can be marked as paid manually.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // 6. Check Order Status
                    // ===========================================

                    if (
                        order.orderStatus ===
                        "cancelled"
                    ) {
                        socket.emit(
                            "mark-order-paid-error",
                            {
                                message:
                                    "Cancelled order cannot be marked as paid.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // 7. Check Current Payment Status
                    // ===========================================

                    if (
                        order.paymentStatus ===
                        "paid"
                    ) {
                        socket.emit(
                            "mark-order-paid-error",
                            {
                                message:
                                    "Order payment is already marked as paid.",
                            }
                        );

                        return;
                    }

                    if (
                        order.paymentStatus ===
                        "refunded"
                    ) {
                        socket.emit(
                            "mark-order-paid-error",
                            {
                                message:
                                    "Refunded order cannot be marked as paid.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // 8. Update Order Payment Status
                    // ===========================================

                    await strapi
                        .documents("api::order.order")
                        .update({
                            documentId:
                                orderDocumentId,
                            data: {
                                paymentStatus:
                                    "paid",
                            },
                        });

                    // ===========================================
                    // 9. Update Payment Collection
                    // ===========================================

                    const paymentCollections =
                        (order as any)
                            .payment_collections;

                    if (
                        paymentCollections?.length
                    ) {

                        for (
                            const payment
                            of paymentCollections
                        ) {

                            await strapi
                                .documents(
                                    "api::payment-collection.payment-collection"
                                )
                                .update({
                                    documentId:
                                        payment.documentId,
                                    data: {
                                        payment_status:
                                            "paid",
                                        paymentDate:
                                            new Date(),
                                    },
                                });
                        }
                    }

                    // ===========================================
                    // 10. Get Latest Updated Order
                    // ===========================================

                    const updatedOrder =
                        await strapi
                            .documents(
                                "api::order.order"
                            )
                            .findOne({
                                documentId:
                                    orderDocumentId,
                                populate: {
                                    payment_collections:
                                        true,

                                },
                            });

                    if (!updatedOrder) {
                        socket.emit(
                            "mark-order-paid-error",
                            {
                                message:
                                    "Updated order could not be found.",
                            }
                        );

                        return;
                    }

                    // ===========================================
                    // 11. Inform Admin / Staff
                    // ===========================================

                    io.to("admin-orders").emit(
                        "order-updated",
                        {
                            order: updatedOrder,
                            status: null,
                        }
                    );

                    // ===========================================
                    // 12. Success Response To Admin
                    // ===========================================

                    socket.emit(
                        "mark-order-paid-success",
                        {
                            message:
                                "Order payment marked as paid successfully.",
                            orderDocumentId:
                                updatedOrder.documentId,
                            orderNo:
                                updatedOrder.orderNo,
                            orderStatus:
                                updatedOrder.orderStatus,
                            paymentStatus:
                                updatedOrder.paymentStatus,
                        }
                    );

                } catch (error: any) {

                    console.error(
                        "Socket Mark Order Paid Error:",
                        error
                    );

                    socket.emit(
                        "mark-order-paid-error",
                        {
                            message:
                                error?.message ||
                                "Failed to mark order as paid.",
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