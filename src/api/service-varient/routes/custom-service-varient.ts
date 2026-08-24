export default {
  routes: [
    {
      method: "GET",
      path: "/service-variants",
      handler: "service-varient.find",
      config: {
        auth: {},
      },
    },
    {
      method: "GET",
      path: "/service-variants/:id",
      handler: "service-varient.findOne",
      config: {
        auth: {},
      },
    },
    {
      method: "POST",
      path: "/service-variants",
      handler: "service-varient.create",
      config: {
        auth: {},
      },
    },
    {
      method: "PUT",
      path: "/service-variants/:id",
      handler: "service-varient.update",
      config: {
        auth: {},
      },
    },
    {
      method: "DELETE",
      path: "/service-variants/:id",
      handler: "service-varient.delete",
      config: {
        auth: {},
      },
    },
    {
      method: "GET",
      path: "/service-varients/best-sellers",
      handler: "service-varient.getBestSellerVariants",
      config: {
        auth: {},
      },
    },
  ],
};
