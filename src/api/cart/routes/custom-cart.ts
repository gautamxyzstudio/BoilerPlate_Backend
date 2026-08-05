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
            path: "/update-cart-items/:id",
            handler: "cart.updateCartItems",
            config: {
                auth: {},
            },
        },
    ]
}