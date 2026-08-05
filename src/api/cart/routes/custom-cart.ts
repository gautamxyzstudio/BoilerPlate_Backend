export default {
    routes: [
        {
            method: "GET",
            path: "/my-cart",
            handler: "cart.getMyCart",
            config: {
                auth: {},
            },
        },
        {
            method: "PATCH",
            path: "/cart-items/:id",
            handler: "cart.removeItem",
            config: {
                auth: {},
            },
        }
    ]
}