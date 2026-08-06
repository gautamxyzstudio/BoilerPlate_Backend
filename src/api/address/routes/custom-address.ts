export default {
    routes: [
        {
            method: "PUT",
            path: "/addresses/:documentId/set-default-address",
            handler: "address.setDefaultAddress",
            config: {
                auth: {},
            },
        },
         {
            method: "GET",
            path: "/default-address",
            handler: "address.getDefaultAddress",
            config: {
                auth: {},
            },
        },

    ]
}