export default {
    routes: [
        {
            method: "PUT",
            path: "/notifications/:documentId/read",
            handler: "custom-notification.markAsRead",
            config: {
                auth: {}
            },
        },
        {
            method: "PUT",
            path: "/notifications/mark-all-read",
            handler: "custom-notification.markAllAsRead",
            config: {
                auth: {}
            },
        }
    ]
}