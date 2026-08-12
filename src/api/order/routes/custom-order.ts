export default {
    routes: [
        {
            method: "GET",
            path: "/admin/order-stats",
            handler: "custom-order.getOrderStats",
            config: {
                auth: {},
            },
        },
        {
            method: "GET",
            path: "/admin/order-service-stats",
            handler: "custom-order.orderServiceStats",
            config: {
                auth: {},
            },
        },
        {
            method: "GET",
            path: "/admin/revenue-trends",
            handler: "custom-order.revenueTrends",
            config: {
                auth: {},
            },
        },
        {
            method: "GET",
            path: "/admin/all-dashboard-stats",
            handler: "custom-order.allDashboardStats",
            config: {
                auth: {},
            },
        },
    ]
}