export default {
    routes: [
        {
            method: "GET",
            path: "/admin/order-stats",
            handler: "custom-order.getOrderStats",
            config: {
                auth: {},
            },
        }
    ]
}