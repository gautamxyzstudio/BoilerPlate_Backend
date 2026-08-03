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
    ],
};