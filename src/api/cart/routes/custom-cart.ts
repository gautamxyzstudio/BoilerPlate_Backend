export default {
    routes: [
        {
            method: "GET",
            path: "/my-cart",
            handler: "cart.getMyCart",
            config: {
                auth: {},
            },
        }
    ]
}