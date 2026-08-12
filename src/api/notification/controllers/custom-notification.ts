import type { Context } from "koa";

export default {

    async markAsRead(ctx: Context) {
        try {
            const user = ctx.state.user;

            // ============================================
            // Check logged-in user
            // ============================================

            if (!user) {
                return ctx.unauthorized(
                    "You must be logged in."
                );
            }

            // ============================================
            // Get Notification documentId
            // ============================================

            const { documentId } = ctx.params;

            if (!documentId) {
                return ctx.badRequest(
                    "Notification documentId is required."
                );
            }

            // ============================================
            // Find Notification
            // ============================================

            const notification = await strapi.db
                .query("api::notification.notification")
                .findOne({
                    where: {
                        documentId,
                    },
                });

            if (!notification) {
                return ctx.notFound(
                    "Notification not found."
                );
            }

            // ============================================
            // Find Reader for Logged-in User
            // ============================================

            const existingReader = await strapi.db
                .query(
                    "api::notification-reader.notification-reader"
                )
                .findOne({
                    where: {
                        users_permissions_user: user.id,
                        notification: notification.id,
                    },
                });

            // ============================================
            // Already Read
            // ============================================

            if (existingReader?.isRead === true) {
                return ctx.send({
                    message: "Notification is already marked as read.",
                });
            }

            // ============================================
            // Reader Exists but Unread
            // ============================================

            if (existingReader) {
                await strapi.db
                    .query(
                        "api::notification-reader.notification-reader"
                    )
                    .update({
                        where: {
                            id: existingReader.id,
                        },
                        data: {
                            isRead: true,
                            readAt: new Date(),
                        },
                    });

                return ctx.send({
                    message: "Notification marked as read.",
                });
            }

            // ============================================
            // No Reader Record
            // Create New Reader
            // ============================================

            await strapi.db
                .query(
                    "api::notification-reader.notification-reader"
                )
                .create({
                    data: {
                        users_permissions_user: user.id,
                        notification: notification.id,
                        isRead: true,
                        readAt: new Date(),
                    },
                });

            // ============================================
            // Response
            // ============================================

            return ctx.send({
                message: "Notification marked as read.",
            });
        } catch (error) {
            strapi.log.error(
                "Error marking notification as read:",
                error
            );

            return ctx.internalServerError(
                "Failed to mark notification as read."
            );
        }
    },

    async markAllAsRead(ctx: Context) {
        try {
            const user = ctx.state.user;

            // ============================================
            // Check logged-in user
            // ============================================

            if (!user) {
                return ctx.unauthorized(
                    "You must be logged in."
                );
            }

            // ============================================
            // Get All Notifications
            // ============================================

            const notifications = await strapi.db
                .query("api::notification.notification")
                .findMany({
                    select: ["id", "documentId"],
                });

            if (notifications.length === 0) {
                return ctx.send({
                    message: "No notifications found.",
                    count: 0,
                });
            }

            // ============================================
            // Get Existing Readers For Logged-in User
            // ============================================

            const existingReaders = await strapi.db
                .query(
                    "api::notification-reader.notification-reader"
                )
                .findMany({
                    where: {
                        users_permissions_user: user.id,
                    },
                    select: [
                        "id",
                        "isRead",
                        "readAt",
                    ],
                    populate: {
                        notification: {
                            select: ["id"],
                        },
                    },
                });

            // ============================================
            // Create Map Of Existing Readers
            // ============================================

            const readerMap = new Map();

            existingReaders.forEach((reader) => {
                if (reader.notification) {
                    readerMap.set(
                        reader.notification.id,
                        reader
                    );
                }
            });

            // ============================================
            // Find Notifications That Need To Be Read
            // ============================================

            const readersToUpdate = [];
            const notificationsToCreate = [];

            for (const notification of notifications) {
                const existingReader = readerMap.get(
                    notification.id
                );

                // Already read
                if (existingReader?.isRead === true) {
                    continue;
                }

                // Reader exists but is unread
                if (existingReader) {
                    readersToUpdate.push(existingReader.id);
                    continue;
                }

                // No reader record = unread
                notificationsToCreate.push(notification.id);
            }

            // ============================================
            // Nothing To Mark
            // ============================================

            if (
                readersToUpdate.length === 0 &&
                notificationsToCreate.length === 0
            ) {
                return ctx.send({
                    message:
                        "All notifications are already marked as read.",
                    count: 0,
                });
            }

            const readAt = new Date();

            // ============================================
            // Update Existing Unread Readers
            // ============================================

            await Promise.all(
                readersToUpdate.map((readerId) =>
                    strapi.db
                        .query(
                            "api::notification-reader.notification-reader"
                        )
                        .update({
                            where: {
                                id: readerId,
                            },
                            data: {
                                isRead: true,
                                readAt,
                            },
                        })
                )
            );

            // ============================================
            // Create Missing Reader Records
            // ============================================

            await Promise.all(
                notificationsToCreate.map(
                    (notificationId) =>
                        strapi.db
                            .query(
                                "api::notification-reader.notification-reader"
                            )
                            .create({
                                data: {
                                    users_permissions_user: user.id,
                                    notification: notificationId,
                                    isRead: true,
                                    readAt,
                                },
                            })
                )
            );

            // ============================================
            // Total Marked
            // ============================================

            const markedCount =
                readersToUpdate.length +
                notificationsToCreate.length;

            // ============================================
            // Response
            // ============================================

            return ctx.send({
                message: "All notifications marked as read.",
                count: markedCount,
            });
        } catch (error) {
            strapi.log.error(
                "Error marking all notifications as read:",
                error
            );

            return ctx.internalServerError(
                "Failed to mark all notifications as read."
            );
        }
    }

}