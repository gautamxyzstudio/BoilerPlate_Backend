export default {
    routes: [
        {
            method: "GET",
            path: "/services/:name",
            handler: "service.findServiceByName",
            config: {
                auth: {},
            },
        },
        {
            method: "GET",
            path: "/admin/services-with-variants",
            handler: "service.getServicesWithVariants",
            config: {
                auth: {},
            },
        },
    ],
};